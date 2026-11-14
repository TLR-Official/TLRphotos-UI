/**
 * @file ZoomTool - 无极缩放工具
 * @description
 *  CSS transform: scale() 实现无极缩放（0.1x - 8x）。
 *  支持滚轮缩放（以鼠标位置为中心）、按钮缩放、拖拽平移。
 *
 *  滚轮缩放交互优化：
 *  - 原生 wheel 监听器（passive: false），确保 preventDefault() 跨浏览器生效
 *  - 鼠标悬停在图片区域内时滚轮仅缩放图片，禁止页面滚动
 *  - 鼠标离开图片区域后自动恢复页面默认滚动
 *  - 基于 deltaY 的指数缩放（exp），适配鼠标滚轮与触控板
 *  - rAF 批处理合并同一帧内多次滚轮事件（delta 累加），防止卡顿
 *  - deltaMode 标准化（Firefox lines→pixels、pages→pixels）
 *  - 缩放中心始终跟随鼠标指针位置
 *  - 缩放状态视觉反馈（百分比徽章 + 渐隐动画）
 *  - stopPropagation 防止事件冒泡至父级滚动容器
 *
 *  关键设计：图片与叠加层位于同一变换层，
 *  拖拽/缩放时叠加层随图片同步移动。
 *  禁用浏览器原生图片拖拽（onDragStart 拦截 + draggable=false + select-none）。
 */

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';

interface ZoomToolProps {
  active: boolean;
  children: ReactNode;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** 滚轮灵敏度系数：deltaY × 此值 → exp 指数 */
const WHEEL_SENSITIVITY = 0.0015;
/** 按钮点击缩放步长 */
const BUTTON_STEP = 0.2;
/** 缩放指示器自动隐藏延迟（ms） */
const INDICATOR_FADE_MS = 1500;

export function ZoomTool({ active, children }: ZoomToolProps) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [showIndicator, setShowIndicator] = useState(false);
  // 拖拽中：用 state（而非 ref）驱动 transition，保证拖拽期间真正禁用过渡
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  // 变换层：拖拽时直接写 style.transform，避免每帧 React 重渲染
  const transformRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const dragLastDelta = useRef({ dx: 0, dy: 0 });
  const dragRafRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  // rAF 批处理状态
  const wheelDeltaAccRef = useRef(0); // 累积 delta
  const wheelOriginRef = useRef<{ x: number; y: number } | null>(null); // 最新鼠标位置
  const rafIdRef = useRef<number | null>(null);
  // 指示器定时器
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const zoomBy = useCallback((factor: number, originX?: number, originY?: number) => {
    setScale((prev) => {
      const next = clamp(prev * factor, MIN_SCALE, MAX_SCALE);
      if (next === prev) return prev;
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

  /** 触发缩放指示器显示，并在延迟后自动渐隐 */
  const flashIndicator = useCallback(() => {
    setShowIndicator(true);
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(() => setShowIndicator(false), INDICATOR_FADE_MS);
  }, []);

  // ── 原生 wheel 监听器（passive: false 确保 preventDefault 跨浏览器生效）──
  // V4.10.0：仅在缩放工具激活时绑定，未激活时页面保持正常滚动
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // 禁止页面滚动 + 阻止冒泡至父级滚动容器
      e.preventDefault();
      e.stopPropagation();

      const rect = container.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;

      // 跨浏览器 deltaMode 标准化 → 统一为像素单位
      //   deltaMode 0 = 像素（Chrome/Safari/Edge 默认）
      //   deltaMode 1 = 行（Firefox 滚轮模式，每行约 16px）
      //   deltaMode 2 = 页（罕见）
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 100;

      // 累积 delta + 记录最新鼠标位置（同帧多次事件取最新位置）
      wheelDeltaAccRef.current += delta;
      wheelOriginRef.current = { x: ox, y: oy };

      // rAF 批处理：同帧内多次滚轮合并为单次缩放更新
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const totalDelta = wheelDeltaAccRef.current;
          const origin = wheelOriginRef.current;
          wheelDeltaAccRef.current = 0;
          if (!origin) return;

          // 指数缩放：exp(-delta * sensitivity)
          //   deltaY > 0（下滚）→ factor < 1 → 缩小
          //   deltaY < 0（上滚）→ factor > 1 → 放大
          //   累加 delta 与分步应用结果一致（exp(a)*exp(b) = exp(a+b)）
          const factor = Math.exp(-totalDelta * WHEEL_SENSITIVITY);
          zoomBy(factor, origin.x, origin.y);
          flashIndicator();
        });
      }
    };

    // passive: false 是 preventDefault() 生效的前提
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
    };
  }, [active, zoomBy, flashIndicator]);

  // ── 外部快捷键事件（键盘 +/-/0）──
  useEffect(() => {
    const onZoomIn = () => { zoomBy(1 + BUTTON_STEP); flashIndicator(); };
    const onZoomOut = () => { zoomBy(1 / (1 + BUTTON_STEP)); flashIndicator(); };
    const onReset = () => { resetZoom(); flashIndicator(); };

    window.addEventListener('audit:zoom-in', onZoomIn);
    window.addEventListener('audit:zoom-out', onZoomOut);
    window.addEventListener('audit:reset-zoom', onReset);
    return () => {
      window.removeEventListener('audit:zoom-in', onZoomIn);
      window.removeEventListener('audit:zoom-out', onZoomOut);
      window.removeEventListener('audit:reset-zoom', onReset);
    };
  }, [zoomBy, resetZoom, flashIndicator]);

  // ── 拖拽平移（已放大即可拖动，不再要求缩放工具处于激活态 — V4.11 修复审核端无法拖动）──
  // V4.10.0：拖拽帧内直接写 transform，不逐帧 setState；松手后才同步一次位置状态
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale === 1) return;
      e.preventDefault();
      isDragging.current = true;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, tx, ty };
      dragLastDelta.current = { dx: 0, dy: 0 };
      pointerRef.current = { x: e.clientX, y: e.clientY };
    },
    [scale, tx, ty]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) return;
      pointerRef.current = { x: e.clientX, y: e.clientY };
      // 同一帧内多次 mousemove 合并为一次样式写入
      if (dragRafRef.current !== null) return;
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null;
        if (!isDragging.current || !transformRef.current) return;
        const dx = pointerRef.current.x - dragStart.current.x;
        const dy = pointerRef.current.y - dragStart.current.y;
        dragLastDelta.current = { dx, dy };
        transformRef.current.style.transform = `translate(${dragStart.current.tx + dx}px, ${dragStart.current.ty + dy}px) scale(${scale})`;
      });
    },
    [scale]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    // 提交最终位置：React 重渲染后由 state 接管样式
    setTx(dragStart.current.tx + dragLastDelta.current.dx);
    setTy(dragStart.current.ty + dragLastDelta.current.dy);
    setDragging(false);
  }, []);

  // 卸载时清理拖拽 rAF
  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const isZoomed = scale !== 1;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragStart={handleDragStart}
      className={`relative overflow-hidden select-none ${
        isZoomed ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* 变换层：图片 + 叠加层同层，拖拽/缩放时同步移动 */}
      <div
        ref={transformRef}
        className="relative"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: 'center center',
          // 拖拽期间禁用过渡，避免指针跟随发飘；松手/滚轮时保留轻微缓动
          transition: dragging ? 'none' : 'transform 0.06s ease-out',
          willChange: 'transform',
        }}
      >
        {children}
      </div>

      {/* 缩放指示器徽章：缩放时始终显示，无操作后渐隐 */}
      {isZoomed && (
        <div
          className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/75 backdrop-blur text-white text-xs rounded-lg pointer-events-none z-30 transition-opacity duration-300 ${
            showIndicator || active ? 'opacity-100' : 'opacity-50'
          }`}
        >
          <span className="font-mono font-medium">{(scale * 100).toFixed(0)}%</span>
          {!active && <span className="text-white/60">滚轮缩放</span>}
        </div>
      )}

      {/* 完整控制条：仅在缩放工具激活时显示 */}
      {active && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-gray-200 z-30">
          <button
            onClick={() => { zoomBy(1 / (1 + BUTTON_STEP)); flashIndicator(); }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="缩小 (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm font-mono text-gray-700 w-14 text-center">
            {(scale * 100).toFixed(0)}%
          </span>
          <button
            onClick={() => { zoomBy(1 + BUTTON_STEP); flashIndicator(); }}
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

      {/* 拖拽提示：已放大即显示（左上角，避免与右上角徽章重叠） */}
      {isZoomed && (
        <div className="absolute top-3 left-3 px-2 py-1 bg-blue-700/80 text-white text-xs rounded pointer-events-none z-30">
          拖拽移动 | 滚轮缩放
        </div>
      )}
    </div>
  );
}
