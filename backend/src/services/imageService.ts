/**
 * @file 图片处理服务
 * @description 基于 sharp 库实现图片缩略图、预览图生成及水印合成。
 *              处理结果以 Buffer 形式返回，由调用方负责上传至 OSS。
 */

import sharp from 'sharp';
import { uploadBufferToOSS, generateFileKey } from './ossService';

/** 水印配置：坐标以百分比（0-100）描述，基于预览图尺寸进行换算 */
export interface WatermarkConfig {
  text: string;
  x: number;
  y: number;
  opacity: number;
  size: number;
  font?: string;
}

/** 图片处理结果：包含各类衍生图的 OSS Key 与 Buffer */
export interface ProcessedImages {
  thumbnailKey: string;
  thumbnailBuffer: Buffer;
  previewKey: string;
  previewBuffer: Buffer;
  watermarkedKey?: string;
  watermarkedBuffer?: Buffer;
}

/**
 * 处理原始图片，生成缩略图、预览图（及可选水印图）
 * @param buffer 原始图片二进制数据
 * @param fileName 原始文件名，用于推导 OSS Key
 * @param watermarkConfig 水印配置，未提供则跳过水印合成
 * @returns 各衍生图的 OSS Key 与 Buffer
 */
export async function processImage(
  buffer: Buffer,
  fileName: string,
  watermarkConfig?: WatermarkConfig
): Promise<ProcessedImages> {
  console.log(`[ImageProcessing] Starting processing for: ${fileName}`);
  const startTime = Date.now();

  const fileKey = generateFileKey(fileName);
  // 去除扩展名，得到用于拼接衍生 Key 的基础名
  const baseName = fileKey.replace(/\.[^/.]+$/, '');

  // 派生缩略图、预览图、水印图的 OSS Key，均转换为 webp 格式
  const thumbnailKey = `photos/thumbnails/${baseName.split('/')[1]}_thumb.webp`;
  const previewKey = `photos/previews/${baseName.split('/')[1]}_preview.webp`;
  const watermarkedKey = `photos/watermarked/${baseName.split('/')[1]}_watermarked.webp`;

  const image = sharp(buffer);
  const metadata = await image.metadata();

  console.log(`[ImageProcessing] Original image: ${metadata.width}x${metadata.height}, size: ${buffer.length} bytes`);

  // 并行生成缩略图（800px、质量 80）与预览图（1200px、质量 90）：
  // - rotate() 根据 EXIF 自动校正方向
  // - fit.inside 保证不变形、不放大，按短边适配
  const [thumbnailBuffer, previewBuffer] = await Promise.all([
    image
      .clone()
      .rotate()
      .resize(800, 800, {
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer(),
    image
      .clone()
      .rotate()
      .resize(1200, 1200, {
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer(),
  ]);

  console.log(`[ImageProcessing] Thumbnail and preview generated in ${Date.now() - startTime}ms`);

  let watermarkedBuffer: Buffer | undefined;
  if (watermarkConfig && watermarkConfig.text) {
    const fontSize = watermarkConfig.size || 32;
    const opacity = watermarkConfig.opacity || 0.6;

    // 基于预览图实际尺寸计算水印位置与字体缩放
    const previewMetadata = await sharp(previewBuffer).metadata();
    const processedWidth = previewMetadata.width || 1200;
    const processedHeight = previewMetadata.height || 1200;

    // 将百分比坐标钳制到 [0,100] 区间，再换算为像素坐标
    const xPercent = Math.min(Math.max(watermarkConfig.x, 0), 100);
    const yPercent = Math.min(Math.max(watermarkConfig.y, 0), 100);
    const x = (processedWidth * xPercent) / 100;
    const y = (processedHeight * yPercent) / 100;

    // 字体随图片长边线性缩放，保证不同尺寸下水印视觉比例一致
    const scaleFactor = Math.max(processedWidth, processedHeight) / 1200;
    const scaledFontSize = fontSize * scaleFactor;

    // 构造透明背景的 SVG 文本图层，再通过 sharp 渲染为 PNG 用于合成
    const textBuffer = await sharp({
      create: {
        width: processedWidth,
        height: processedHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${processedWidth}" height="${processedHeight}">
          <text x="${x}" y="${y}" font-family="${watermarkConfig.font || 'Arial'}"
                font-size="${scaledFontSize}" font-weight="600" fill="white" opacity="${opacity}"
                text-anchor="middle" dominant-baseline="middle"
                stroke="black" stroke-width="1" stroke-opacity="${opacity * 0.5}">
            ${watermarkConfig.text}
          </text>
        </svg>`),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();

    // 将文本图层叠加到预览图上，输出最终带水印的 webp
    watermarkedBuffer = await sharp(previewBuffer)
      .composite([{
        input: textBuffer,
        top: 0,
        left: 0,
        blend: 'over',
      }])
      .webp({ quality: 90 })
      .toBuffer();

    console.log(`[ImageProcessing] Watermark added in ${Date.now() - startTime}ms`);
  }

  console.log(`[ImageProcessing] Total processing time: ${Date.now() - startTime}ms`);

  return {
    thumbnailKey,
    thumbnailBuffer,
    previewKey,
    previewBuffer,
    ...(watermarkedBuffer ? { watermarkedKey, watermarkedBuffer } : {}),
  };
}

/**
 * 将处理后的图片批量上传至 OSS
 * @param images 由 processImage 产出的衍生图集合
 * @returns 各衍生图对应的可访问 URL（水印图可选）
 */
export async function uploadProcessedImages(images: ProcessedImages): Promise<{
  thumbnailUrl: string;
  previewUrl: string;
  watermarkedUrl?: string;
}> {
  // 并发上传缩略图、预览图及可选水印图
  const results = await Promise.all([
    uploadBufferToOSS(images.thumbnailBuffer, images.thumbnailKey, 'image/webp'),
    uploadBufferToOSS(images.previewBuffer, images.previewKey, 'image/webp'),
    ...(images.watermarkedBuffer && images.watermarkedKey
      ? [uploadBufferToOSS(images.watermarkedBuffer, images.watermarkedKey, 'image/webp')]
      : []),
  ]);

  return {
    thumbnailUrl: results[0],
    previewUrl: results[1],
    ...(results[2] ? { watermarkedUrl: results[2] } : {}),
  };
}
