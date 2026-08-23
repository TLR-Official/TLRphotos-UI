/**
 * @file HistogramTool - 三色直方图工具
 * @description
 *  在面板内用 Canvas 绘制 RGB 三通道叠加柱状图（256 bin）。
 *  红色通道填充半透明红，绿色填充半透明绿，蓝色填充半透明蓝，
 *  重叠区域自然混色。X 轴 0-255，Y 轴归一化到 max bin 值。
 */

import { useEffect, useRef } from 'react';
import { ToolPanel, MetricCard } from '../components/ToolPanel';
import { useHistogram, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface HistogramToolProps {
  visible: boolean;
  onClose: () => void;
  pixels: UseImagePixelsResult;
}

export function HistogramTool({ visible, onClose, pixels }: HistogramToolProps) {
  const histogram = useHistogram(pixels.imageData);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !histogram) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 280;
    const H = 120;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const { red, green, blue, max } = histogram;
    const binWidth = W / 256;

    // 绘制背景网格
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (W / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // 三通道叠加：使用 'lighter' 合成模式让重叠区域变亮
    ctx.globalCompositeOperation = 'lighter';

    const drawChannel = (bins: number[], color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) {
        const x = i * binWidth;
        const y = H - (bins[i] / max) * H * 0.95;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };

    drawChannel(red, 'rgba(255, 0, 0, 0.4)');
    drawChannel(green, 'rgba(0, 255, 0, 0.4)');
    drawChannel(blue, 'rgba(0, 0, 255, 0.4)');

    ctx.globalCompositeOperation = 'source-over';
  }, [visible, histogram]);

  return (
    <ToolPanel title="三色直方图" visible={visible} onClose={onClose}>
      {pixels.loading && <p className="text-sm text-gray-400">加载像素数据中...</p>}
      {pixels.error && <p className="text-sm text-red-500">{pixels.error}</p>}
      {histogram && (
        <>
          <div className="rounded-lg bg-gray-900 p-2 mb-3">
            <canvas ref={canvasRef} className="w-full" style={{ height: '120px' }} />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mb-3">
            <span>0 (暗部)</span>
            <span>128 (中调)</span>
            <span>255 (高光)</span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-red-500" />
              <span className="text-gray-600">红色通道</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-green-500" />
              <span className="text-gray-600">绿色通道</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-blue-500" />
              <span className="text-gray-600">蓝色通道</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100">
            <MetricCard
              label="采样规格"
              value={`${pixels.sampledWidth}×${pixels.sampledHeight}`}
              hint={`原图 ${pixels.naturalWidth}×${pixels.naturalHeight}`}
            />
          </div>
        </>
      )}
    </ToolPanel>
  );
}
