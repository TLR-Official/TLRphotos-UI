/**
 * @file AuditToolbar - 工具栏组件
 * @description
 *  图标按钮组，展示在图片预览区上方。点击切换对应工具的激活状态。
 *  支持折叠/展开（~ 键），折叠时只显示一行精简按钮。
 */

import {
  BarChart3,
  Grid3x3,
  Slash,
  Sparkles,
  Contrast,
  ZoomIn,
  Palette,
  Focus,
  Thermometer,
  AlertTriangle,
  ChevronsRightLeft,
} from 'lucide-react';
import type { ToolId, ToolMeta } from '../types';

/** 所有工具的元信息（顺序即按钮顺序） */
export const TOOL_METAS: ToolMeta[] = [
  { id: 'histogram', label: '直方图', shortcut: 'H', icon: BarChart3, mode: 'panel' },
  { id: 'grid', label: '九宫格', shortcut: 'G', icon: Grid3x3, mode: 'overlay' },
  { id: 'diagonal', label: '对角线', shortcut: 'D', icon: Slash, mode: 'overlay' },
  { id: 'blemish', label: '脏污检测', shortcut: 'B', icon: Sparkles, mode: 'overlay' },
  { id: 'contrast', label: '对比度', shortcut: 'C', icon: Contrast, mode: 'panel' },
  { id: 'zoom', label: '缩放', shortcut: 'Z', icon: ZoomIn, mode: 'action' },
  { id: 'saturation', label: '饱和度', shortcut: 'S', icon: Palette, mode: 'panel' },
  { id: 'sharpness', label: '锐度', shortcut: 'R', icon: Focus, mode: 'panel' },
  { id: 'colorTemp', label: '色温', shortcut: 'T', icon: Thermometer, mode: 'panel' },
  { id: 'clipping', label: '溢出警告', shortcut: 'L', icon: AlertTriangle, mode: 'overlay' },
];

interface AuditToolbarProps {
  /** 当前激活的工具集合 */
  activeTools: Set<ToolId>;
  /** 切换工具激活状态 */
  onToggle: (id: ToolId) => void;
  /** 工具栏是否折叠 */
  collapsed: boolean;
  /** 切换折叠 */
  onToggleCollapse: () => void;
}

/**
 * 审核工具栏
 */
export function AuditToolbar({ activeTools, onToggle, collapsed, onToggleCollapse }: AuditToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-white border border-gray-200 rounded-t-xl">
      <div className="flex items-center gap-1 flex-wrap">
        {TOOL_METAS.map((tool) => {
          const Icon = tool.icon;
          const active = activeTools.has(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => onToggle(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              {!collapsed && <span>{tool.label}</span>}
              {active && (
                <kbd className="ml-0.5 text-[10px] font-mono px-1 py-0.5 rounded bg-purple-200 text-purple-800">
                  {tool.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onToggleCollapse}
          title="折叠/展开工具栏 (~)"
          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <ChevronsRightLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
