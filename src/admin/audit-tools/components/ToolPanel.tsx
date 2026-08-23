/**
 * @file ToolPanel - 工具面板容器
 * @description
 *  静态侧边面板，承载数据类工具的内容（直方图、对比度、饱和度等）。
 *  作为 flex 布局的子元素，占据图片右侧空间，不遮挡图片内容。
 *  支持折叠/展开，带平滑过渡动画。
 */

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ToolPanelProps {
  /** 面板标题 */
  title: string;
  /** 是否显示 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 面板内容 */
  children: ReactNode;
}

/**
 * 工具面板容器（静态侧边栏，不遮挡图片）
 */
export function ToolPanel({ title, visible, onClose, children }: ToolPanelProps) {
  if (!visible) return null;
  return (
    <div className="w-80 bg-white border-l border-gray-200 shadow-xl flex flex-col h-full transition-all duration-300">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 overflow-y-auto flex-1">{children}</div>
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
