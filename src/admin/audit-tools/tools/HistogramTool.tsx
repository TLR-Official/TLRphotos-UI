/**
 * @file HistogramTool - 三色直方图 + 黑白曝光直方图
 * @description
 *  在面板内用 Canvas 绘制：
 *  1. RGB 三通道叠加柱状图（256 bin，'lighter' 合成模式使重叠区变亮）
 *  2. 黑白亮度直方图（BT.601 加权 Y = 0.299R + 0.587G + 0.114B）
 *  颜色使用高不透明度（0.75）确保视觉清晰。
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
  const rgbCanvasRef = useRef<HTMLCanvasElement>(null);
  const lumCanvasRef = useRef<HTMLCanvasElement>(null);

  // 绘制 RGB 三色直方图
  useEffect(() => {
    if (!visible || !histogram) return;
    const canvas = rgbCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 280;
    const H = 110;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const { red, green, blue, max } = histogram;
    const binWidth = W / 256;

    // 背景网格
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (W / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // 三通道叠加：'lighter' 合成模式让重叠区域变亮
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

    // 高不透明度（0.75）确保颜色清晰
    drawChannel(red, 'rgba(255, 40, 40, 0.75)');
    drawChannel(green, 'rgba(40, 255, 40, 0.75)');
    drawChannel(blue, 'rgba(40, 80, 255, 0.75)');

    ctx.globalCompositeOperation = 'source-over';
  }, [visible, histogram]);

  // 绘制黑白亮度直方图
  useEffect(() => {
    if (!visible || !histogram) return;
    const canvas = lumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 280;
    const H = 80;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const { luminance, lumMax } = histogram;
    const binWidth = W / 256;

    // 背景网格
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (W / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // 亮度直方图：白色填充 + 描边，模拟从暗到亮的水平渐变
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const x = i * binWidth;
      const y = H - (luminance[i] / lumMax) * H * 0.92;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();

    // 渐变填充：左黑右白，直观体现曝光分布
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#1a1a1a');
    grad.addColorStop(0.5, '#888888');
    grad.addColorStop(1, '#f0f0f0');
    ctx.fillStyle = grad;
    ctx.fill();

    // 描边
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const x = i * binWidth;
      const y = H - (luminance[i] / lumMax) * H * 0.92;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.stroke();
  }, [visible, histogram]);

  return (
    <ToolPanel title="直方图分析" visible={visible} onClose={onClose}>
      {pixels.loading && <p className="text-sm text-gray-400">加载像素数据中...</p>}
      {pixels.error && <p className="text-sm text-red-500">{pixels.error}</p>}
      {histogram && (
        <>
          {/* RGB 三色直方图 */}
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">RGB 三通道</p>
            <div className="rounded-lg bg-gray-900 p-2">
              <canvas ref={rgbCanvasRef} className="w-full" style={{ height: '110px' }} />
            </div>
          </div>

          {/* 黑白曝光直方图 */}
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1.5 font-medium">黑白曝光</p>
            <div className="rounded-lg bg-gray-900 p-2">
              <canvas ref={lumCanvasRef} className="w-full" style={{ height: '80px' }} />
            </div>
          </div>

          {/* 色阶标尺 */}
          <div className="flex justify-between text-xs text-gray-400 mb-3">
            <span>0 (暗部)</span>
            <span>128 (中调)</span>
            <span>255 (高光)</span>
          </div>

          {/* 通道图例 */}
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
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-gradient-to-r from-gray-900 to-gray-200" />
              <span className="text-gray-600">亮度（黑白曝光）</span>
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
