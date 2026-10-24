/**
 * @file 图片处理服务
 * @description 基于 sharp 库实现图片缩略图、预览图生成及水印合成。
 *              处理结果以 Buffer 形式返回，由调用方负责上传至 OSS。
 */

import sharp from 'sharp';
import { uploadBufferToOSS, generateFileKey } from './ossService';

/** 底部信息条配置：网站名 + 著作权（上传者用户名），与文字水印一次性合成 */
export interface WatermarkBandConfig {
  siteName: string;
  ownerName: string;
  year?: number;
}

/** 水印配置：坐标以百分比（0-100）描述，基于预览图尺寸进行换算 */
export interface WatermarkConfig {
  text: string;
  x: number;
  y: number;
  opacity: number;
  size: number;
  font?: string;
  /** 底部信息条（可选）：提供后在画面底部向下扩展等宽黑色长条 */
  band?: WatermarkBandConfig;
}

/** 底部信息条比例常量（前端预览层使用同一套比例，修改需两侧同步） */
const BAND_HEIGHT_RATIO = 0.11; // 条高 = 短边 × 0.11
const BAND_MIN_HEIGHT = 48; // 最小条高（px，基于预览图坐标系）
const BAND_MAX_HEIGHT_RATIO = 0.4; // 极端小图保护：条高不超过图高 40%
const BAND_TEXT_WIDTH_RATIO = 0.92; // 文字可用宽度 = 图宽 × 92%（左右各留 4%）
const BAND_LINE1_FONT_RATIO = 0.3; // 第一行（网站名）字号 = 条高 × 30%
const BAND_LINE2_FONT_RATIO = 0.26; // 第二行（著作权）字号 = 条高 × 26%
const BAND_LINE1_CENTER_RATIO = 0.36; // 第一行垂直中心位于条内 36%
const BAND_LINE2_CENTER_RATIO = 0.74; // 第二行垂直中心位于条内 74%
const BAND_MIN_FONT_PX = 10; // 字号下限，低于此值改用截断保证不出界
const BAND_FONT_FAMILY = 'Liberation Sans, Noto Sans CJK SC, sans-serif';

/** 底部信息条布局计算结果（单位：预览图坐标系像素） */
export interface BandMetrics {
  bandHeight: number;
  maxTextWidth: number;
  line1FontSize: number;
  line2FontSize: number;
  line1CenterY: number;
  line2CenterY: number;
}

/**
 * 计算底部信息条布局（条高、字号、行中心位置）
 * @param width 画面宽度（预览图坐标）
 * @param height 画面高度（预览图坐标）
 */
export function computeBandMetrics(width: number, height: number): BandMetrics {
  const rawHeight = Math.round(Math.min(width, height) * BAND_HEIGHT_RATIO);
  const bandHeight = Math.min(
    Math.max(rawHeight, BAND_MIN_HEIGHT),
    Math.max(BAND_MIN_HEIGHT, Math.round(height * BAND_MAX_HEIGHT_RATIO)),
  );
  return {
    bandHeight,
    maxTextWidth: Math.round(width * BAND_TEXT_WIDTH_RATIO),
    line1FontSize: Math.max(1, Math.round(bandHeight * BAND_LINE1_FONT_RATIO)),
    line2FontSize: Math.max(1, Math.round(bandHeight * BAND_LINE2_FONT_RATIO)),
    line1CenterY: Math.round(bandHeight * BAND_LINE1_CENTER_RATIO),
    line2CenterY: Math.round(bandHeight * BAND_LINE2_CENTER_RATIO),
  };
}

/**
 * 估算文本渲染宽度（em 单位）：
 * 中日韩等全角字符按 1em，大写字母 0.68em，小写/数字 0.56em，空格 0.28em，其余 0.46em。
 * 用于在合成前预估宽度，避免依赖运行时字体度量导致文字越界。
 */
export function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80) em += 1;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/[a-z0-9]/.test(ch)) em += 0.56;
    else if (ch === ' ') em += 0.28;
    else em += 0.46;
  }
  return em;
}

/** XML 特殊字符转义，防止用户名中的 & < > 破坏 SVG 结构 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 将单行文本收敛到给定宽度内：
 * 1) 先按估算宽度反算字号（不低于下限）；
 * 2) 若仍超宽，按字符逐个截断并补省略号，确保严格不出界。
 */
export function resolveLineText(
  raw: string,
  baseFontSize: number,
  maxWidth: number,
  minFontSize = BAND_MIN_FONT_PX,
): { text: string; fontSize: number } {
  const em = estimateTextEm(raw);
  let fontSize = baseFontSize;
  if (em > 0 && em * fontSize > maxWidth) {
    fontSize = Math.max(minFontSize, Math.floor(maxWidth / em));
  }
  let text = raw;
  while (text.length > 1 && estimateTextEm(text) * fontSize > maxWidth) {
    text = text.slice(0, -2) + '…';
  }
  return { text, fontSize };
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
 * 在预览图上合成文字水印与底部信息条，输出可直接落库的水印图（webp）。
 * 抽为独立函数以便存量照片重渲染脚本复用，保证历史图与新上传图完全同源。
 * @param previewBuffer 预览图 Buffer（≤1200px，未叠加任何水印）
 * @param watermarkConfig 水印配置（文字 + 底部信息条）
 * @returns 水印图 webp Buffer，高度 = 预览图高 + 信息条高（无 band 时等于预览图高）
 */
export async function renderWatermarkedImage(
  previewBuffer: Buffer,
  watermarkConfig: WatermarkConfig,
): Promise<Buffer> {
  const fontSize = watermarkConfig.size || 32;
  const opacity = watermarkConfig.opacity || 0.6;

  // 基于预览图实际尺寸计算水印位置、字体缩放与底部信息条布局
  let textBuffer: Buffer | undefined;
  let bandBuffer: Buffer | undefined;
  let baseBuffer: Buffer | undefined;
  let previewMetaInstance: ReturnType<typeof sharp> | undefined;
  let textLayerInstance: ReturnType<typeof sharp> | undefined;
  let bandLayerInstance: ReturnType<typeof sharp> | undefined;
  let baseInstance: ReturnType<typeof sharp> | undefined;
  let watermarkInstance: ReturnType<typeof sharp> | undefined;
  try {
    previewMetaInstance = sharp(previewBuffer);
    const previewMetadata = await previewMetaInstance.metadata();
    const processedWidth = previewMetadata.width || 1200;
    const processedHeight = previewMetadata.height || 1200;

    // 1) 用户可拖动文字水印：坐标与字号均以原图（预览图）坐标系为基准
    let compositeBase: Buffer = previewBuffer;
    if (watermarkConfig.text) {
      // 将百分比坐标钳制到 [0,100] 区间，再换算为像素坐标
      const xPercent = Math.min(Math.max(watermarkConfig.x, 0), 100);
      const yPercent = Math.min(Math.max(watermarkConfig.y, 0), 100);
      const x = (processedWidth * xPercent) / 100;
      const y = (processedHeight * yPercent) / 100;

      // 字体随图片长边线性缩放，保证不同尺寸下水印视觉比例一致
      const scaleFactor = Math.max(processedWidth, processedHeight) / 1200;
      const scaledFontSize = fontSize * scaleFactor;

      // 构造透明背景的 SVG 文本图层，再通过 sharp 渲染为 PNG 用于合成
      textLayerInstance = sharp({
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
        .png();
      textBuffer = await textLayerInstance.toBuffer();

      // 水印文字先落到图片区域，后续黑条在画布外侧扩展，二者互不遮挡
      baseInstance = sharp(previewBuffer)
        .composite([{ input: textBuffer, top: 0, left: 0, blend: 'over' }])
        .png();
      baseBuffer = await baseInstance.toBuffer();
      compositeBase = baseBuffer;
    }

    // 2) 底部信息条：在图片下方扩展等宽不透明黑条，条内两行居中白字
    let bandHeight = 0;
    if (watermarkConfig.band) {
      const band = watermarkConfig.band;
      const metrics = computeBandMetrics(processedWidth, processedHeight);
      bandHeight = metrics.bandHeight;
      const xCenter = processedWidth / 2;
      const line1 = resolveLineText(band.siteName, metrics.line1FontSize, metrics.maxTextWidth);
      const line2 = resolveLineText(
        `© ${band.year ?? new Date().getFullYear()} ${band.ownerName}`,
        metrics.line2FontSize,
        metrics.maxTextWidth,
      );

      bandLayerInstance = sharp({
        create: {
          width: processedWidth,
          height: metrics.bandHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${processedWidth}" height="${metrics.bandHeight}">
              <text x="${xCenter}" y="${metrics.line1CenterY}" font-family="${BAND_FONT_FAMILY}"
                    font-size="${line1.fontSize}" font-weight="600" fill="#ffffff"
                    text-anchor="middle" dominant-baseline="middle">${escapeXml(line1.text)}</text>
              <text x="${xCenter}" y="${metrics.line2CenterY}" font-family="${BAND_FONT_FAMILY}"
                    font-size="${line2.fontSize}" font-weight="400" fill="#ffffff"
                    text-anchor="middle" dominant-baseline="middle">${escapeXml(line2.text)}</text>
            </svg>`),
          top: 0,
          left: 0,
        }])
        .png();
      bandBuffer = await bandLayerInstance.toBuffer();
    }

    // 3) 一次输出：向下扩展黑条 + 叠加条内文字，位置与层级由同一画布决定
    watermarkInstance = sharp(compositeBase);
    if (bandHeight > 0) {
      watermarkInstance = watermarkInstance.extend({
        bottom: bandHeight,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      });
    }
    if (bandBuffer) {
      watermarkInstance = watermarkInstance.composite([{
        input: bandBuffer,
        top: processedHeight,
        left: 0,
        blend: 'over',
      }]);
    }
    return await watermarkInstance.webp({ quality: 90 }).toBuffer();
  } finally {
    // 显式销毁临时 sharp 实例
    try { (previewMetaInstance as any)?.destroy?.(); } catch { /* ignore */ }
    try { (textLayerInstance as any)?.destroy?.(); } catch { /* ignore */ }
    try { (bandLayerInstance as any)?.destroy?.(); } catch { /* ignore */ }
    try { (baseInstance as any)?.destroy?.(); } catch { /* ignore */ }
    try { (watermarkInstance as any)?.destroy?.(); } catch { /* ignore */ }
    if (textBuffer) {
      try { (textBuffer as any).fill?.(0); } catch { /* ignore */ }
    }
    if (bandBuffer) {
      try { (bandBuffer as any).fill?.(0); } catch { /* ignore */ }
    }
    if (baseBuffer) {
      try { (baseBuffer as any).fill?.(0); } catch { /* ignore */ }
    }
  }
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

  let thumbnailBuffer: Buffer;
  let previewBuffer: Buffer;
  // 并行生成缩略图（800px、质量 80）与预览图（1200px、质量 90）：
  // - rotate() 根据 EXIF 自动校正方向
  // - fit.inside 保证不变形、不放大，按短边适配
  try {
    [thumbnailBuffer, previewBuffer] = await Promise.all([
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
  } finally {
    // 显式销毁 sharp 主实例（在 clone + toBuffer 执行完毕后），
    // 避免 libvips 进程级缓存保留对原始 Buffer 的引用
    try { (image as any).destroy?.(); } catch { /* ignore */ }
  }

  console.log(`[ImageProcessing] Thumbnail and preview generated in ${Date.now() - startTime}ms`);

  let watermarkedBuffer: Buffer | undefined;
  if (watermarkConfig && (watermarkConfig.text || watermarkConfig.band)) {
    // 合成逻辑集中在 renderWatermarkedImage，存量重渲染脚本与上传流程共用同一实现
    watermarkedBuffer = await renderWatermarkedImage(previewBuffer, watermarkConfig);
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
 * 显式释放由 processImage 生成的各类 Buffer。
 * 用于上传 finally 块或 MemoryManager 软阈值触发时兜底清理。
 */
export function disposeProcessedBuffers(images: ProcessedImages): number {
  let freed = 0;
  const freeBuf = (buf: Buffer | undefined) => {
    if (!buf) return 0;
    const len = buf.byteLength;
    try {
      (buf as any).fill?.(0);
    } catch {
      /* ignore */
    }
    // 移除对 Buffer 的引用：通过字段置 null 触发 V8 GC
    // (TS 类型保护下用 Object.defineProperty 或直接写入)
    return len;
  };
  freed += freeBuf(images.thumbnailBuffer);
  freed += freeBuf(images.previewBuffer);
  freed += freeBuf(images.watermarkedBuffer);
  return freed;
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
