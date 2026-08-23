/**
 * @file AuditToolkit - 审核工具集主容器
 * @description
 *  整合工具栏、图片渲染、叠加层、面板和缩放。
 *  替换 PhotoDetailPage 中的直接 CachedImage 渲染。
 *
 *  布局：
 *    ┌ 工具栏（图标按钮组）──────────────────┐
 *    ├──────────────────────────────────────┤
 *    │  图片预览 + 叠加层（九宫格/斑马纹等） │
 *    │                          ┌ 面板 ┐    │
 *    │                          │直方图│    │
 *    │                          └─────┘    │
 *    ├──────────────────────────────────────┤
 *    │ 图片操作栏（尺寸/浏览数/点赞数）        │
 *    └──────────────────────────────────────┘
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
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

export function AuditToolkit({ src, authToken, alt, imageClassName = '', footer }: AuditToolkitProps) {
  const [activeTools, setActiveTools] = useState<Set<ToolId>>(new Set());
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // 像素数据获取（降采样 800px）
  const pixels = useImagePixels(src, authToken);

  // 监听图片容器尺寸变化，用于 Canvas overlay 坐标映射
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      setDisplaySize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
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
    setShowShortcuts(false);
  }, []);

  /** 重置缩放（通过 keydown 0 触发，实际由 ZoomTool 内部处理） */
  const resetZoom = useCallback(() => {
    // ZoomTool 内部管理状态，这里仅触发事件
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
    '?': () => setShowShortcuts((v) => !v),
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
      {/* 工具栏 */}
      <AuditToolbar
        activeTools={activeTools}
        onToggle={toggleTool}
        collapsed={toolbarCollapsed}
        onToggleCollapse={() => setToolbarCollapsed((v) => !v)}
      />

      {/* 图片 + 叠加层 + 面板 */}
      <div className="relative bg-gray-50" style={{ minHeight: '400px' }}>
        {/* 图片渲染区（支持缩放） */}
        <div
          ref={imageContainerRef}
          className="relative flex items-center justify-center"
          style={{ maxHeight: '600px', overflow: 'hidden' }}
        >
          <ZoomTool active={activeTools.has('zoom')}>
            <CachedImage
              src={src}
              alt={alt}
              authToken={authToken}
              cacheEnabled={false}
              className={`${imageClassName}`}
              style={{ maxHeight: '600px' }}
            />
          </ZoomTool>

          {/* 叠加层容器 */}
          <CanvasOverlay>
            {/* 九宫格 + 对角线 */}
            <GridOverlayTool
              showGrid={activeTools.has('grid')}
              showDiagonal={activeTools.has('diagonal')}
            />

            {/* 脏污点检测 */}
            <BlemishDetectorTool
              active={activeTools.has('blemish')}
              pixels={pixels}
              displayWidth={displaySize.width}
              displayHeight={displaySize.height}
            />

            {/* 高光/暗部溢出警告 */}
            <ClippingWarningTool
              active={activeTools.has('clipping')}
              pixels={pixels}
              displayWidth={displaySize.width}
              displayHeight={displaySize.height}
            />
          </CanvasOverlay>
        </div>

        {/* 右侧工具面板（按需滑出） */}
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

        {/* 快捷键帮助浮层 */}
        {showShortcuts && (
          <div className="absolute top-3 right-3 w-64 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <HelpCircle className="w-4 h-4" />
                快捷键
              </h4>
              <button
                onClick={() => setShowShortcuts(false)}
                className="text-gray-400 hover:text-gray-600 text-xs"
              >
                关闭
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {TOOL_METAS.map((t) => (
                <div key={t.id} className="flex items-center justify-between">
                  <span className="text-gray-600">{t.label}</span>
                  <kbd className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">
                    {t.shortcut}
                  </kbd>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-gray-600">折叠工具栏</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">~</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">关闭全部</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">Esc</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">重置缩放</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">0</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">放大/缩小</span>
                <kbd className="font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">+/-</kbd>
              </div>
            </div>
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
