import sharp from 'sharp';
import { uploadBufferToOSS, generateFileKey } from './ossService';

export interface WatermarkConfig {
  text: string;
  x: number;
  y: number;
  opacity: number;
  size: number;
  font?: string;
}

export interface ProcessedImages {
  thumbnailKey: string;
  thumbnailBuffer: Buffer;
  previewKey: string;
  previewBuffer: Buffer;
  watermarkedKey?: string;
  watermarkedBuffer?: Buffer;
}

export async function processImage(
  buffer: Buffer,
  fileName: string,
  watermarkConfig?: WatermarkConfig
): Promise<ProcessedImages> {
  console.log(`[ImageProcessing] Starting processing for: ${fileName}`);
  const startTime = Date.now();
  
  const fileKey = generateFileKey(fileName);
  const baseName = fileKey.replace(/\.[^/.]+$/, '');

  const thumbnailKey = `photos/thumbnails/${baseName.split('/')[1]}_thumb.webp`;
  const previewKey = `photos/previews/${baseName.split('/')[1]}_preview.webp`;
  const watermarkedKey = `photos/watermarked/${baseName.split('/')[1]}_watermarked.webp`;

  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  console.log(`[ImageProcessing] Original image: ${metadata.width}x${metadata.height}, size: ${buffer.length} bytes`);

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

    const previewMetadata = await sharp(previewBuffer).metadata();
    const processedWidth = previewMetadata.width || 1200;
    const processedHeight = previewMetadata.height || 1200;

    const xPercent = Math.min(Math.max(watermarkConfig.x, 0), 100);
    const yPercent = Math.min(Math.max(watermarkConfig.y, 0), 100);
    const x = (processedWidth * xPercent) / 100;
    const y = (processedHeight * yPercent) / 100;

    const scaleFactor = Math.max(processedWidth, processedHeight) / 1200;
    const scaledFontSize = fontSize * scaleFactor;

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

export async function uploadProcessedImages(images: ProcessedImages): Promise<{
  thumbnailUrl: string;
  previewUrl: string;
  watermarkedUrl?: string;
}> {
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
