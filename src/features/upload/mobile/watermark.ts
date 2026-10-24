/**
 * @file 移动端水印配置常量与工具
 * @description
 *  从 WatermarkEditor 拆出的纯数据/纯函数模块（避免组件文件混合导出影响 Fast Refresh）。
 *  字号与位置语义与桌面端 UploadPage 及后端 imageService 完全同源：
 *  size 为 1200px 长边基准字号；位置为百分比坐标，后端以 text-anchor=middle 中心锚点渲染。
 */

/** 水印设置值（posIndex 0~8 先行后列；size 基准字号；opacity 0.1~1.0） */
export interface WatermarkValue {
  posIndex: number;
  size: number;
  opacity: number;
}

/** 九宫格行列对应的百分比坐标（文字以该点为视觉中心，边缘留距防裁切） */
const GRID_PERCENT = [15, 50, 85];

/** 九宫格位置中文标签（摘要展示用，先行后列） */
export const WATERMARK_POS_LABELS = [
  '左上', '上中', '右上',
  '左中', '居中', '右中',
  '左下', '下中', '右下',
] as const;

/** 字号三档（基准 1200px 长边；中档 32 与桌面端默认值一致） */
export const WATERMARK_SIZE_TIERS = [
  { label: '小', size: 20 },
  { label: '中', size: 32 },
  { label: '大', size: 48 },
] as const;

/** 默认水印设置：居中 / 中档字号 / 60% 透明度（与桌面端默认值一致） */
export const DEFAULT_WATERMARK: WatermarkValue = { posIndex: 4, size: 32, opacity: 0.6 };

/**
 * 九宫格索引 → 百分比坐标
 * @param posIndex 0~8（先行后列）
 * @returns { x, y } 百分比坐标（0~100）
 */
export function watermarkPosToXY(posIndex: number): { x: number; y: number } {
  const col = posIndex % 3;
  const row = Math.floor(posIndex / 3);
  return { x: GRID_PERCENT[col], y: GRID_PERCENT[row] };
}
