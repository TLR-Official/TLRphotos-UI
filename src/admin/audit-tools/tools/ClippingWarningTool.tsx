/**
 * @file ClippingWarningTool - 高光/暗部溢出警告
 * @description
 *  标记 RGB 均值 > 245（高光溢出）或 < 10（暗部溢出）的像素，
 *  以斑马纹形式叠加在图片上：
 *  - 高光溢出：红色斑马纹
 *  - 暗部溢出：蓝色斑马纹
 *  帮助审核员快速发现细节丢失区域。
 */

import { useMemo } from 'react';
import { PixelCanvas } from '../components/CanvasOverlay';
import { useClipping, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface ClippingWarningToolProps {
  active: boolean;
  pixels: UseImagePixelsResult;
  displayWidth: number;
  displayHeight: number;
}

export function ClippingWarningTool({ active, pixels, displayWidth, displayHeight }: ClippingWarningToolProps) {
  const clipping = useClipping(active ? pixels.imageData : null);

  const highlightPixels = clipping?.highlightPixels ?? [];
  const shadowPixels = clipping?.shadowPixels ?? [];

  // 为了减少渲染压力，对像素列表进行抽样
  const sampleStep = useMemo(() => {
    const total = highlightPixels.length + shadowPixels.length;
    return total > 5000 ? Math.ceil(total / 5000) : 1;
  }, [highlightPixels.length, shadowPixels.length]);

  const sampledHighlight = useMemo(
    () => highlightPixels.filter((_, i) => i % sampleStep === 0),
    [highlightPixels, sampleStep]
  );
  const sampledShadow = useMemo(
    () => shadowPixels.filter((_, i) => i % sampleStep === 0),
    [shadowPixels, sampleStep]
  );

  if (!active || !pixels.imageData) return null;

  return (
    <>
      <PixelCanvas
        pixels={sampledHighlight}
        sampledWidth={pixels.sampledWidth}
        sampledHeight={pixels.sampledHeight}
        displayWidth={displayWidth}
        displayHeight={displayHeight}
        color="rgba(255, 0, 0, 0.7)"
        pixelSize={3}
      />
      <PixelCanvas
        pixels={sampledShadow}
        sampledWidth={pixels.sampledWidth}
        sampledHeight={pixels.sampledHeight}
        displayWidth={displayWidth}
        displayHeight={displayHeight}
        color="rgba(0, 100, 255, 0.7)"
        pixelSize={3}
      />
    </>
  );
}
