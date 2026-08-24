/**
 * @file SaturationTool - 饱和度分析工具
 * @description
 *  显示平均饱和度、高/低饱和像素占比，
 *  并以色环可视化展示饱和度分布。
 */

import { useEffect, useRef } from 'react';
import { ToolPanel, MetricCard } from '../components/ToolPanel';
import { useSaturation, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface SaturationToolProps {
  visible: boolean;
  onClose: () => void;
  pixels: UseImagePixelsResult;
  initialX?: number;
  initialY?: number;
  boundsRef?: React.RefObject<HTMLElement | null>;
}

export function SaturationTool({ visible, onClose, pixels, initialX, initialY, boundsRef }: SaturationToolProps) {
  const saturation = useSaturation(pixels.imageData);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !saturation) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 120;
    canvas.width = size;
    canvas.height = size;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;

    ctx.clearRect(0, 0, size, size);

    // 绘制色环：外圈高饱和，内圈低饱和
    for (let angle = 0; angle < 360; angle += 2) {
      const rad = (angle * Math.PI) / 180;
      const sat = saturation.avgSaturation;
      ctx.strokeStyle = `hsl(${angle}, ${sat * 100}%, 50%)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + radius * Math.cos(rad), cy + radius * Math.sin(rad));
      ctx.stroke();
    }

    // 中心圆显示平均饱和度
    ctx.fillStyle = `hsl(0, 0%, ${50 - saturation.avgSaturation * 30}%)`;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
  }, [visible, saturation]);

  return (
    <ToolPanel
      title="饱和度分析"
      visible={visible}
      onClose={onClose}
      initialX={initialX}
      initialY={initialY}
      boundsRef={boundsRef}
    >
      {pixels.loading && <p className="text-sm text-gray-400">加载中...</p>}
      {saturation && (
        <>
          <div className="flex justify-center mb-4">
            <canvas ref={canvasRef} width={120} height={120} />
          </div>
          <MetricCard
            label="平均饱和度"
            value={(saturation.avgSaturation * 100).toFixed(1)}
            unit="%"
            hint="0% 灰度图，100% 纯色"
          />
          <MetricCard
            label="高饱和像素占比"
            value={(saturation.highSatRatio * 100).toFixed(1)}
            unit="%"
            hint="饱和度 > 0.6 的像素"
          />
          <MetricCard
            label="低饱和像素占比"
            value={(saturation.lowSatRatio * 100).toFixed(1)}
            unit="%"
            hint="饱和度 < 0.1，接近灰色"
          />
        </>
      )}
    </ToolPanel>
  );
}
