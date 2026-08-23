/**
 * @file 审核工具集类型定义
 * @description 定义工具 ID、工具状态、面板配置等共享类型
 */

/** 工具 ID 枚举 */
export type ToolId =
  | 'histogram'      // 三色直方图
  | 'grid'           // 九宫格辅助线
  | 'diagonal'       // 对角线辅助线
  | 'blemish'        // 脏污点检测
  | 'contrast'       // 对比度量化
  | 'zoom'           // 无极缩放
  | 'saturation'     // 饱和度分析
  | 'sharpness'      // 锐度评估
  | 'colorTemp'      // 色温分析
  | 'clipping';      // 高光/暗部溢出警告

/** 工具展示形式：叠加在图片上 / 右侧面板 / 作用于容器 */
export type ToolDisplayMode = 'overlay' | 'panel' | 'action';

/** 工具元信息 */
export interface ToolMeta {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
  mode: ToolDisplayMode;
}

/** 像素分析结果 */
export interface PixelAnalysis {
  /** 降采样后的 ImageData */
  imageData: ImageData;
  /** 原图宽度 */
  naturalWidth: number;
  /** 原图高度 */
  naturalHeight: number;
  /** 降采样后的宽度 */
  sampledWidth: number;
  /** 降采样后的高度 */
  sampledHeight: number;
}

/** 直方图通道数据（256 bin） */
export interface HistogramData {
  red: number[];
  green: number[];
  blue: number[];
  max: number; // 所有 bin 的最大值，用于归一化绘制
}

/** 对比度量化结果 */
export interface ContrastData {
  /** 亮度标准差 */
  stdDev: number;
  /** RMS 对比度 */
  rms: number;
  /** 平均亮度 (0-255) */
  meanLuminance: number;
  /** 动态范围（最亮-最暗） */
  dynamicRange: number;
}

/** 饱和度分析结果 */
export interface SaturationData {
  /** 平均饱和度 (0-1) */
  avgSaturation: number;
  /** 高饱和像素占比 */
  highSatRatio: number;
  /** 低饱和（接近灰）像素占比 */
  lowSatRatio: number;
}

/** 锐度评估结果 */
export interface SharpnessData {
  /** 拉普拉斯方差，数值越高越清晰 */
  laplacianVariance: number;
  /** 主观评级 */
  rating: 'excellent' | 'good' | 'fair' | 'blurry';
}

/** 色温分析结果 */
export interface ColorTempData {
  /** R 通道均值 */
  rMean: number;
  /** G 通道均值 */
  gMean: number;
  /** B 通道均值 */
  bMean: number;
  /** R/B 比值，>1 暖色温，<1 冷色温 */
  ratio: number;
  /** 偏移方向 */
  bias: 'warm' | 'cool' | 'neutral';
}

/** 溢出警告结果 */
export interface ClippingData {
  /** 高光溢出像素占比 */
  highlightClipRatio: number;
  /** 暗部溢出像素占比 */
  shadowClipRatio: number;
  /** 标记像素坐标数组（降采样空间，用于 Canvas overlay） */
  highlightPixels: Array<{ x: number; y: number }>;
  shadowPixels: Array<{ x: number; y: number }>;
}
