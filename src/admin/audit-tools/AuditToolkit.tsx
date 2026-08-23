/**
 * @file AuditToolkit - 审核工具集主容器
 * @description
 *  整合工具栏、常驻快捷键提示、图片渲染、叠加层、面板和缩放。
 *  替换 PhotoDetailPage 中的直接 CachedImage 渲染。
 *
 *  布局：
 *    ┌ 工具栏（图标按钮组，常驻显示快捷键）──────────┐
 *    ├ 常驻快捷键提示条 ──────────────────────────────┤
 *    ├──────────────────────────────────────────────┤
 *    │  ┌ 图片预览 + 叠加层（同变换层）──┐ ┌ 面板 ┐ │
 *    │  │  （九宫格/脏污点/溢出随图移动）│ │直方图│ │
 *    │  └──────────────────────────────┘ └─────┘ │
 *    ├──────────────────────────────────────────────┤
 *    │ 图片操作栏（尺寸/浏览数/点赞数）               │
 *    └──────────────────────────────────────────────┘
 *
 *  关键设计：
 *    1. 快捷键常驻显示在工具栏按钮和提示条上，无需按 ? 展开
 *    2. 叠加层与图片同处变换层，拖拽/缩放时同步移动
 *    3. 面板作为 flex 兄弟元素位于图片右侧，不遮挡图片
 *    4. 禁用浏览器原生图片拖拽，确保拖拽直接调整位置
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { AuditToolbar, TOOL_METAS } from './components/AuditToolbar';
import { CanvasOverlay } from './components/CanvasOverlay';
import { ZoomTool } from './tools/ZoomTool';
import { HistogramTool } from './tools/HistogramTool';
import { ContrastTool } from './tools/ContrastTool';
import { SaturationTool } from './tools/SaturationTool';
import { SharpnessTool } from './tools/SharpnessTool';
import { ColorTempTool } from './tools/ColorTempTool';
import { GridOverlayTool } from './tools/GridOverlayTool';
import { BlemishDetectorTool } from './tools/BlemishDetectorTool';
import { ClippingWarningTool } from './tools/ClippingWarningTool';
import { useImagePixels } from './hooks/useImagePixels';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { CachedImage } from '../../components/CachedImage';
import type { ToolId } from './types';

interface AuditToolkitProps {
  /** 图片 URL */
  src: string;
  /** 管理员 token */
  authToken?: string;
  /** alt 文本 */
  alt: string;
  /** 图片 className（透传给 CachedImage） */
  imageClassName?: string;
  /** 图片操作栏（底部信息条，由调用方提供） */
  footer?: ReactNode;
}

/** 常驻快捷键提示条的工具项 */
const SHORTCUT_GROUPS: { label: string; items: { name: string; key: string }[] }[] = [
  {
    label: '叠加',
    items: [
      { name: '九宫格', key: 'G' },
      { name: '对角线', key: 'D' },
      { name: '脏污', key: 'B' },
      { name: '溢出', key: 'L' },
    ],
  },
  {
    label: '面板',
    items: [
      { name: '直方图', key: 'H' },
      { name: '对比度', key: 'C' },
      { name: '饱和度', key: 'S' },
      { name: '锐度', key: 'R' },
      { name: '色温', key: 'T' },
    ],
  },
  {
    label: '操作',
    items: [
      { name: '缩放', key: 'Z' },
      { name: '重置', key: '0' },
      { name: '放大', key: '+' },
      { name: '缩小', key: '-' },
      { name: '关闭', key: 'Esc' },
    ],
  },
];

export function AuditToolkit({ src, authToken, alt, imageClassName = '', footer }: AuditToolkitProps) {
  const [activeTools, setActiveTools] = useState<Set<ToolId>>(new Set());
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  // imageWrapperRef：直接包裹图片的容器，用于测量图片渲染尺寸 + 作为 overlay 定位基准
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // 像素数据获取（降采样 800px）
  const pixels = useImagePixels(src, authToken);

  // 监听图片容器尺寸变化，用于 Canvas overlay 坐标映射
  useEffect(() => {
    const wrapper = imageWrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      setDisplaySize({
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  /** 切换工具激活状态 */
  const toggleTool = useCallback((id: ToolId) => {
    setActiveTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  /** 关闭所有面板和叠加层 */
  const closeAll = useCallback(() => {
    setActiveTools(new Set());
  }, []);

  /** 重置缩放（ZoomTool 内部监听事件处理） */
  const resetZoom = useCallback(() => {
    window.dispatchEvent(new CustomEvent('audit:reset-zoom'));
  }, []);

  /** 快捷键配置 */
  const shortcutConfig = {
    h: () => toggleTool('histogram'),
    g: () => toggleTool('grid'),
    d: () => toggleTool('diagonal'),
    b: () => toggleTool('blemish'),
    c: () => toggleTool('contrast'),
    z: () => toggleTool('zoom'),
    s: () => toggleTool('saturation'),
    r: () => toggleTool('sharpness'),
    t: () => toggleTool('colorTemp'),
    l: () => toggleTool('clipping'),
    '~': () => setToolbarCollapsed((v) => !v),
    escape: closeAll,
    '0': resetZoom,
    '+': () => window.dispatchEvent(new CustomEvent('audit:zoom-in')),
    '=': () => window.dispatchEvent(new CustomEvent('audit:zoom-in')),
    '-': () => window.dispatchEvent(new CustomEvent('audit:zoom-out')),
  };

  useKeyboardShortcuts(shortcutConfig, true);

  // 当前激活的面板类工具（panel 模式，取第一个激活的）
  const activePanelTool: ToolId | null =
    Array.from(activeTools).find((id) =>
      TOOL_METAS.find((t) => t.id === id)?.mode === 'panel'
    ) ?? null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* 工具栏（快捷键常驻显示在按钮上） */}
      <AuditToolbar
        activeTools={activeTools}
        onToggle={toggleTool}
        collapsed={toolbarCollapsed}
        onToggleCollapse={() => setToolbarCollapsed((v) => !v)}
      />

      {/* 常驻快捷键提示条 */}
      <div className="flex items-center gap-4 px-3 py-1.5 bg-gray-50 border-x border-gray-200 text-[11px] text-gray-500 overflow-x-auto">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.label} className="flex items-center gap-1.5 shrink-0">
            <span className="text-gray-400 font-medium">{group.label}:</span>
            {group.items.map((item) => (
              <span key={item.key} className="flex items-center gap-0.5">
                <span>{item.name}</span>
                <kbd className="font-mono px-1 py-0.5 rounded bg-white text-gray-600 border border-gray-300 text-[10px]">
                  {item.key}
                </kbd>
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* 图片 + 面板（flex 布局，面板不遮挡图片） */}
      <div className="flex bg-gray-50" style={{ minHeight: '400px' }}>
        {/* 图片区域（flex-1 占满剩余空间） */}
        <div className="flex-1 flex items-center justify-center" style={{ maxHeight: '600px', overflow: 'hidden' }}>
          <ZoomTool active={activeTools.has('zoom')}>
            {/* 图片 + 叠加层同处变换层：拖拽/缩放时同步移动 */}
            <div ref={imageWrapperRef} className="relative">
              <CachedImage
                src={src}
                alt={alt}
                authToken={authToken}
                cacheEnabled={false}
                className={`${imageClassName}`}
                draggable={false}
                style={{ maxHeight: '600px' }}
              />
              {/* 叠加层：位于图片上方第二层（z-10），随图片同步移动 */}
              <CanvasOverlay>
                <GridOverlayTool
                  showGrid={activeTools.has('grid')}
                  showDiagonal={activeTools.has('diagonal')}
                />
                <BlemishDetectorTool
                  active={activeTools.has('blemish')}
                  pixels={pixels}
                  displayWidth={displaySize.width}
                  displayHeight={displaySize.height}
                />
                <ClippingWarningTool
                  active={activeTools.has('clipping')}
                  pixels={pixels}
                  displayWidth={displaySize.width}
                  displayHeight={displaySize.height}
                />
              </CanvasOverlay>
            </div>
          </ZoomTool>
        </div>

        {/* 工具面板：flex 兄弟元素，位于图片右侧，不遮挡图片 */}
        {activePanelTool && (
          <div className="flex-shrink-0">
            {activePanelTool === 'histogram' && (
              <HistogramTool
                visible={true}
                onClose={() => toggleTool('histogram')}
                pixels={pixels}
              />
            )}
            {activePanelTool === 'contrast' && (
              <ContrastTool
                visible={true}
                onClose={() => toggleTool('contrast')}
                pixels={pixels}
              />
            )}
            {activePanelTool === 'saturation' && (
              <SaturationTool
                visible={true}
                onClose={() => toggleTool('saturation')}
                pixels={pixels}
              />
            )}
            {activePanelTool === 'sharpness' && (
              <SharpnessTool
                visible={true}
                onClose={() => toggleTool('sharpness')}
                pixels={pixels}
              />
            )}
            {activePanelTool === 'colorTemp' && (
              <ColorTempTool
                visible={true}
                onClose={() => toggleTool('colorTemp')}
                pixels={pixels}
              />
            )}
          </div>
        )}
      </div>

      {/* 图片操作栏（透传自调用方） */}
      {footer && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}
