/**
 * @file ToolPanel - 工具面板容器（可自由拖动的浮动窗口）
 * @description
 *  可拖拽的浮动面板，承载数据类工具的内容（直方图、对比度、饱和度等）。
 *  通过 position: absolute + x/y state 定位，不占用文档流空间，
 *  因此不会挤压/缩裁剪图片区域。用户可拖动到任意位置。
 *
 *  关键设计：
 *    1. 仅使用 CSS position: absolute，从文档流中完全移除
 *    2. 标题栏为拖拽句柄（cursor: grab/grabbing）
 *    3. 初始位置由父组件传入（基于图片区域的外围，避免覆盖图片）
 *    4. 边界约束：拖拽时面板至少保留 40px 的句柄条留在容器可视范围内
 *    5. 防止拖拽时选中文本：select-none + user-select: none
 *    6. 拖拽过程中 transition: none 保证流畅，释放后恢复过渡
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Move } from 'lucide-react';
import type { ReactNode } from 'react';

/** 面板默认宽度（px） */
export const PANEL_WIDTH = 320;
/** 面板默认最小高度（px，大致估算，实际会被内容撑开） */
export const PANEL_DEFAULT_HEIGHT = 420;
/** 边界约束：至少保留的可见宽度（拖拽句柄条高度，防止面板被拖到完全看不见） */
const MIN_VISIBLE = 40;

interface ToolPanelProps {
  /** 面板标题 */
  title: string;
  /** 是否显示（父级 conditionally render 时使用） */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 面板内容 */
  children: ReactNode;
  /** 初始位置 x（相对父容器左上角） */
  initialX?: number;
  /** 初始位置 y（相对父容器左上角） */
  initialY?: number;
  /** 约束边界容器的 ref —— 拖拽时限制面板不越过此容器可视区域范围（至少保留句柄可见） */
  boundsRef?: React.RefObject<HTMLElement | null>;
}

/**
 * 工具面板容器（可自由拖动的浮动窗口，不占用文档流）
 */
export function ToolPanel({
  title,
  visible,
  onClose,
  children,
  initialX = 0,
  initialY = 0,
  boundsRef,
}: ToolPanelProps) {
  // 面板当前位置（相对父容器 absolute，CSS left/top 同坐标系，即 offsetParent 的 padding-box）
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  /**
   * 拖拽起始快照（纯 delta 模式，避免坐标系转换漂移）
   *  - mouseX/Y: 鼠标在 viewport 中的起始像素坐标（event.clientX/Y）
   *  - panelX/Y: 面板在 offsetParent padding-box 坐标系中的起始 CSS 位置（= panel.offsetLeft/Top）
   * 两者都使用各自的"绝对"坐标空间，移动时仅叠加 delta，无需互相换算。
   */
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  /** 约束 x/y 至 boundsRef 容器的可视区域，至少保留 MIN_VISIBLE 像素可见 */
  const clampToBounds = useCallback(
    (x: number, y: number): { x: number; y: number } => {
      const panel = panelRef.current;
      const bounds = boundsRef?.current;
      if (!panel) return { x, y };

      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;
      const boundsWidth = bounds ? bounds.clientWidth : Infinity;
      const boundsHeight = bounds ? bounds.clientHeight : Infinity;

      // 限制 x：min=-(panelWidth-MIN_VISIBLE), max=boundsWidth-MIN_VISIBLE
      const minX = Math.min(0, -(panelWidth - MIN_VISIBLE));
      const maxX = boundsWidth - MIN_VISIBLE;
      const cx = Math.min(maxX, Math.max(minX, x));

      // 限制 y：min=-(panelHeight-MIN_VISIBLE), max=boundsHeight-MIN_VISIBLE
      const minY = Math.min(0, -(panelHeight - MIN_VISIBLE));
      const maxY = boundsHeight - MIN_VISIBLE;
      const cy = Math.min(maxY, Math.max(minY, y));

      return { x: cx, y: cy };
    },
    [boundsRef]
  );

  // 初始化：如果有 boundsRef 则约束一次初始位置（首次渲染）
  useEffect(() => {
    setPos((p) => clampToBounds(p.x, p.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 拖拽开始：记录鼠标位置 & 面板 DOM 位置的起始快照 ──
  // 用 DOM 原生 offsetLeft/Top（值与 CSS left/top 完全同坐标系，避免 getBoundingClientRect
  // border-box 与 CSS padding-box 混用导致的恒定偏移漂移）
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;

      dragStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        panelX: panel.offsetLeft, // DOM 原生值，与 CSS left 完全一致（含边界约束已落盘）
        panelY: panel.offsetTop,
      };

      // 提升 z-index 保证被拖面板在最上
      panel.style.zIndex = '60';
    },
    []
  );

  // ── 全局鼠标移动与抬起：使用原生 listener 保证拖出 panel 仍能捕获 ──
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const panel = panelRef.current;
      if (!panel) return;

      const s = dragStart.current;
      // 纯 delta：鼠标移动了多少像素，面板 CSS 位置就移动多少像素 — 完全不涉及坐标换算
      const deltaX = e.clientX - s.mouseX;
      const deltaY = e.clientY - s.mouseY;
      const nextX = s.panelX + deltaX;
      const nextY = s.panelY + deltaY;

      // 函数式 setState + 每次从起始位置重算（防 React 批处理中旧闭包状态造成累积跳变）
      setPos(() => clampToBounds(nextX, nextY));
    };

    const handleUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      const panel = panelRef.current;
      if (panel) panel.style.zIndex = '50';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [clampToBounds]);

  // visible 检查必须在所有 Hook 之后（React Hooks 顺序不变原则）
  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className="absolute bg-white rounded-xl border border-gray-200 shadow-2xl flex flex-col select-none"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: PANEL_WIDTH,
        maxHeight: 'calc(100% - 16px)',
        zIndex: 50,
        // 统一用 inline transition 精确控制，避免与 className 里的 transition 类互相覆盖导致拖拽抖帧
        // 拖拽时完全禁用过渡（保证 1:1 跟手），非拖拽时仅 box-shadow 需要过渡（悬停/交互阴影变化），left/top 保持 0 延迟跳变
        transition: isDragging.current ? 'none' : 'box-shadow 150ms ease, left 0s linear, top 0s linear',
      }}
    >
      {/* 拖拽句柄：标题栏 */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-100 rounded-t-xl bg-gray-50 cursor-grab active:cursor-grabbing"
        title="拖动移动面板"
      >
        <div className="flex items-center gap-2">
          <Move className="w-3.5 h-3.5 text-gray-400" />
          <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* 内容区 */}
      <div className="p-4 overflow-y-auto flex-1 rounded-b-xl">{children}</div>
    </div>
  );
}

/** 数值展示卡片：大数字 + 标签 */
export function MetricCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg p-3 bg-gray-50 border border-gray-100 mb-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800">
        {value}
        {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/** 参考标准条：三段渐变指示 */
export function ReferenceBar({
  value,
  max,
  thresholds,
}: {
  value: number;
  max: number;
  thresholds: { low: number; high: number };
}) {
  const percent = Math.min(100, (value / max) * 100);
  const lowPct = (thresholds.low / max) * 100;
  const highPct = (thresholds.high / max) * 100;

  return (
    <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-green-200 via-yellow-200 to-red-200">
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-gray-800"
        style={{ left: `${lowPct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-gray-800"
        style={{ left: `${highPct}%` }}
      />
      <div
        className="absolute top-0 w-1 h-full bg-purple-600 rounded-full shadow-lg"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}
