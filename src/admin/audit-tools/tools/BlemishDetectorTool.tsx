/**
 * @file BlemishDetectorTool - 脏污点智能检测
 * @description
 *  对降采样图像分块（16×16 像素），计算每块的局部方差。
 *  在低方差（平滑）区域内，检测局部梯度异常的像素，
 *  标记为潜在脏污点（与周围环境差异明显但范围很小的瑕疵）。
 *
 * 算法：
 *  1. 将图像分为 16×16 的块
 *  2. 计算每块方差，低于阈值 σ²_low 的块为"平滑块"
 *  3. 在平滑块中，计算每个像素与局部均值的差异
 *  4. 差异 > δ_diff 的像素标记为脏污点
 */

import { useMemo } from 'react';
import { PixelCanvas } from '../components/CanvasOverlay';
import type { UseImagePixelsResult } from '../hooks/useImagePixels';

interface BlemishDetectorToolProps {
  active: boolean;
  pixels: UseImagePixelsResult;
  displayWidth: number;
  displayHeight: number;
}

/** 分块大小 */
const BLOCK_SIZE = 16;
/** 平滑块方差阈值 */
const LOW_VAR_THRESHOLD = 200;
/** 像素与局部均值差异阈值 */
const DIFF_THRESHOLD = 40;

export function BlemishDetectorTool({ active, pixels, displayWidth, displayHeight }: BlemishDetectorToolProps) {
  const blemishPixels = useMemo(() => {
    if (!active || !pixels.imageData) return [];

    const { data, width, height } = pixels.imageData;
    const result: Array<{ x: number; y: number }> = [];

    const getLum = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };

    // 遍历所有 16x16 块
    for (let by = 0; by < height - BLOCK_SIZE; by += BLOCK_SIZE) {
      for (let bx = 0; bx < width - BLOCK_SIZE; bx += BLOCK_SIZE) {
        // 计算块内均值和方差
        let sum = 0;
        const lums: number[] = [];
        for (let y = by; y < by + BLOCK_SIZE; y++) {
          for (let x = bx; x < bx + BLOCK_SIZE; x++) {
            const lum = getLum(x, y);
            lums.push(lum);
            sum += lum;
          }
        }
        const count = lums.length;
        const mean = sum / count;
        const variance = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / count;

        // 只在平滑块中检测脏污点
        if (variance >= LOW_VAR_THRESHOLD) continue;

        // 检测与局部均值差异显著的像素
        for (let y = by; y < by + BLOCK_SIZE; y++) {
          for (let x = bx; x < bx + BLOCK_SIZE; x++) {
            const lum = getLum(x, y);
            const diff = Math.abs(lum - mean);
            if (diff > DIFF_THRESHOLD) {
              result.push({ x, y });
            }
          }
        }
      }
    }

    return result;
  }, [active, pixels.imageData]);

  if (!active || !pixels.imageData) return null;

  return (
    <PixelCanvas
      pixels={blemishPixels}
      sampledWidth={pixels.sampledWidth}
      sampledHeight={pixels.sampledHeight}
      displayWidth={displayWidth}
      displayHeight={displayHeight}
      color="rgba(255, 50, 50, 0.8)"
      pixelSize={4}
    />
  );
}
