/**
 * @file ZoomTool - 无极缩放工具
 * @description
 *  CSS transform: scale() 实现无极缩放（0.1x - 8x）。
 *  支持滚轮缩放（以鼠标位置为中心）、按钮缩放、拖拽平移。
 *  缩放模式下显示缩放百分比和操作提示。
 *
 *  关键设计：图片与叠加层（九宫格/脏污点/溢出警告）位于同一变换层，
 *  拖拽/缩放时叠加层随图片同步移动，避免叠加层被置顶的异常。
 *  禁用浏览器原生图片拖拽（onDragStart 拦截 + draggable=false + select-none），
 *  确保拖拽操作直接实现图片位置调整。
 */

import { useState, useRef, useCallback, type ReactNode } from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';

interface ZoomToolProps {
  active: boolean;
  children: ReactNode;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const SCALE_STEP = 0.2;

export function ZoomTool({ active, children }: ZoomToolProps) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const zoomBy = useCallback((factor: number, originX?: number, originY?: number) => {
    setScale((prev) => {
      const next = clamp(prev * factor, MIN_SCALE, MAX_SCALE);
      if (next === prev) return prev;

      // 以指定点为缩放中心调整位移
      if (originX !== undefined && originY !== undefined) {
        setTx((prevTx) => originX - (originX - prevTx) * (next / prev));
        setTy((prevTy) => originY - (originY - prevTy) * (next / prev));
      }
      return next;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!active) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1 + SCALE_STEP : 1 - SCALE_STEP;
      zoomBy(factor, ox, oy);
    },
    [active, zoomBy]
  );

  // 拖拽平移：preventDefault 阻止浏览器原生图片拖拽幽灵
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!active || scale === 1) return;
      e.preventDefault();
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY, tx, ty };
    },
    [active, scale, tx, ty]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTx(dragStart.current.tx + dx);
      setTy(dragStart.current.ty + dy);
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // 禁止浏览器原生拖拽（防止 img 被拖出产生幽灵图像）
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragStart={handleDragStart}
      // 禁用文本选中与原生图片拖拽，确保拖拽操作直接调整图片位置
      className={`relative overflow-hidden select-none ${
        active && scale !== 1 ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* 变换层：图片 + 叠加层同层，拖拽/缩放时同步移动 */}
      <div
        className="relative"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: isDragging.current ? 'none' : 'transform 0.1s ease-out',
        }}
      >
        {children}
      </div>

      {/* 缩放控制条：位于顶层（z-30），不参与变换 */}
      {active && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 z-30">
          <button
            onClick={() => zoomBy(1 / (1 + SCALE_STEP))}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="缩小 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm font-mono text-gray-700 w-14 text-center">
            {(scale * 100).toFixed(0)}%
          </span>
          <button
            onClick={() => zoomBy(1 + SCALE_STEP)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="放大 (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-6 bg-gray-200" />
          <button
            onClick={resetZoom}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="重置 (0)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setScale(MAX_SCALE)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="适应窗口"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 拖拽提示 */}
      {active && scale > 1 && (
        <div className="absolute top-3 right-3 px-2 py-1 bg-purple-600/80 text-white text-xs rounded pointer-events-none z-30">
          拖拽移动 | 滚轮缩放
        </div>
      )}
    </div>
  );
}
