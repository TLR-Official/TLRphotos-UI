/**
 * @file 水印底部信息条预览布局
 * @description 与 backend/src/services/imageService.ts 中的 computeBandMetrics / resolveLineText
 *              共用同一套比例常量与宽度估算规则，保证上传预览与最终水印图所见即所得。
 *              ⚠️ 修改比例常量时必须与后端同步，否则预览与成品会错位。
 */

/** 条高 = 短边 × 0.11（后端 BAND_HEIGHT_RATIO） */
const BAND_HEIGHT_RATIO = 0.11;
/** 最小条高（以后端预览图 1200px 坐标系为准） */
const BAND_MIN_HEIGHT = 48;
/** 极端小图保护：条高不超过图高 40% */
const BAND_MAX_HEIGHT_RATIO = 0.4;
/** 文字可用宽度 = 图宽 × 92%（左右各留 4%） */
const BAND_TEXT_WIDTH_RATIO = 0.92;
/** 第一行（网站名）字号 = 条高 × 30% */
const BAND_LINE1_FONT_RATIO = 0.3;
/** 第二行（著作权）字号 = 条高 × 26% */
const BAND_LINE2_FONT_RATIO = 0.26;
/** 第一行垂直中心位于条内 36% */
const BAND_LINE1_CENTER_RATIO = 0.36;
/** 第二行垂直中心位于条内 74% */
const BAND_LINE2_CENTER_RATIO = 0.74;
/** 字号下限，低于此值改用截断保证不出界 */
const BAND_MIN_FONT_PX = 10;
/** 后端预览图长边上限（sharp resize 1200 fit:inside） */
const PREVIEW_MAX_EDGE = 1200;

/** 底部信息条在屏幕上渲染所需的全部尺寸（均为屏幕像素） */
export interface BandPreviewLayout {
  /** 条高 */
  height: number;
  /** 第一行文案（可能已截断） */
  line1: string;
  /** 第二行文案（可能已截断） */
  line2: string;
  line1FontSize: number;
  line2FontSize: number;
  /** 第一行垂直中心（相对条顶） */
  line1CenterY: number;
  /** 第二行垂直中心（相对条顶） */
  line2CenterY: number;
}

/**
 * 估算文本渲染宽度（em 单位），规则与后端完全一致：
 * 中日韩等全角字符 1em、大写字母 0.68em、小写/数字 0.56em、空格 0.28em、其余 0.46em。
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

/** 将单行文本收敛到给定宽度内：先缩字号（不低于下限），仍超宽则逐字截断补省略号 */
function resolveLineText(
  raw: string,
  baseFontSize: number,
  maxWidth: number,
): { text: string; fontSize: number } {
  const em = estimateTextEm(raw);
  let fontSize = baseFontSize;
  if (em > 0 && em * fontSize > maxWidth) {
    fontSize = Math.max(BAND_MIN_FONT_PX, Math.floor(maxWidth / em));
  }
  let text = raw;
  while (text.length > 1 && estimateTextEm(text) * fontSize > maxWidth) {
    text = text.slice(0, -2) + '…';
  }
  return { text, fontSize };
}

/**
 * 计算底部信息条的预览布局
 * @param params.naturalWidth 原图宽（浏览器已校正 EXIF 方向）
 * @param params.naturalHeight 原图高
 * @param params.renderedWidth 预览图在屏幕上实际渲染宽度（object-contain 后）
 * @param params.siteName 第一行：网站名称
 * @param params.ownerName 第二行：著作权人（上传者用户名）
 * @param params.year 年份，缺省取当前年
 */
export function computeBandPreviewLayout(params: {
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  siteName: string;
  ownerName: string;
  year?: number;
}): BandPreviewLayout | null {
  const { naturalWidth, naturalHeight, renderedWidth, siteName, ownerName } = params;
  if (naturalWidth <= 0 || naturalHeight <= 0 || renderedWidth <= 0) return null;

  // 后端先把原图等比缩到 1200 以内再合成，故先还原后端预览图尺寸，再按屏幕比例整体缩放
  const fit = Math.min(1, PREVIEW_MAX_EDGE / naturalWidth, PREVIEW_MAX_EDGE / naturalHeight);
  const previewWidth = Math.round(naturalWidth * fit);
  const previewHeight = Math.round(naturalHeight * fit);
  if (previewWidth <= 0 || previewHeight <= 0) return null;

  const rawBandHeight = Math.round(Math.min(previewWidth, previewHeight) * BAND_HEIGHT_RATIO);
  const bandHeight = Math.min(
    Math.max(rawBandHeight, BAND_MIN_HEIGHT),
    Math.max(BAND_MIN_HEIGHT, Math.round(previewHeight * BAND_MAX_HEIGHT_RATIO)),
  );
  const maxTextWidth = Math.round(previewWidth * BAND_TEXT_WIDTH_RATIO);
  const line1 = resolveLineText(siteName, Math.max(1, Math.round(bandHeight * BAND_LINE1_FONT_RATIO)), maxTextWidth);
  const line2 = resolveLineText(
    `© ${params.year ?? new Date().getFullYear()} ${ownerName}`,
    Math.max(1, Math.round(bandHeight * BAND_LINE2_FONT_RATIO)),
    maxTextWidth,
  );

  // 后端坐标系 → 屏幕坐标系的统一缩放系数（与预览字号 scaleFactor 同源）
  const scale = renderedWidth / previewWidth;
  return {
    height: bandHeight * scale,
    line1: line1.text,
    line2: line2.text,
    line1FontSize: line1.fontSize * scale,
    line2FontSize: line2.fontSize * scale,
    line1CenterY: Math.round(bandHeight * BAND_LINE1_CENTER_RATIO) * scale,
    line2CenterY: Math.round(bandHeight * BAND_LINE2_CENTER_RATIO) * scale,
  };
}
