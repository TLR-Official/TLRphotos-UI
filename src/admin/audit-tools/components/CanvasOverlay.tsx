/**
 * @file CanvasOverlay - 叠加层容器
 * @description
 *  绝对定位覆盖在图片容器之上，用于绘制叠加类工具的可视化内容
 *  （九宫格、对角线、脏污点标记、斑马纹等）。
 *  自动适配容器尺寸，支持多工具叠加渲染。
 */

import { useEffect, useRef, type ReactNode } from 'react';

interface CanvasOverlayProps {
  /** 子元素：叠加的内容（绝对定位的 div 或 Canvas） */
  children: ReactNode;
  /** 容器宽度 */
  width: number;
  /** 容器高度 */
  height: number;
}

/**
 * Canvas 叠加层
 * 用于绘制脏污点标记、斑马纹等基于像素坐标的 overlay
 */
export function PixelCanvas({
  pixels,
  sampledWidth,
  sampledHeight,
  displayWidth,
  displayHeight,
  color,
  pixelSize = 3,
}: {
  pixels: Array<{ x: number; y: number }>;
  sampledWidth: number;
  sampledHeight: number;
  displayWidth: number;
  displayHeight: number;
  color: string;
  pixelSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // 从降采样坐标 → 显示坐标的缩放比
    const scaleX = displayWidth / sampledWidth;
    const scaleY = displayHeight / sampledHeight;

    ctx.fillStyle = color;
    for (const { x, y } of pixels) {
      const dx = x * scaleX;
      const dy = y * scaleY;
      // 绘制小方块标记，pixelSize 控制标记大小
      ctx.fillRect(dx - pixelSize / 2, dy - pixelSize / 2, pixelSize, pixelSize);
    }
  }, [pixels, sampledWidth, sampledHeight, displayWidth, displayHeight, color, pixelSize]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

/**
 * 叠加层容器（绝对定位，铺满父容器）
 */
export function CanvasOverlay({ children }: Omit<CanvasOverlayProps, 'width' | 'height'>) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {children}
    </div>
  );
}
