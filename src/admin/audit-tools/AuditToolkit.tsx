/**
 * @file AuditToolkit - 审核工具集主容器
 * @description
 *  整合工具栏、常驻快捷键提示、图片渲染、叠加层、浮动面板和缩放。
 *  替换 PhotoDetailPage 中的直接 CachedImage 渲染。
 *
 *  布局：
 *    ┌ 工具栏（图标按钮组，常驻显示快捷键）──────────┐
 *    ├ 常驻快捷键提示条 ──────────────────────────────┤
 *    ├───────────────────────────────────────────────────┤
 *    │ 图片展示区（100% 全宽，工具面板绝对定位浮在其外围）│
 *    │                                         ┌ 工具面板┐ │
 *    │                                         │（可拖动）│ │
 *    │                                         └──────────┘ │
 *    ├───────────────────────────────────────────────────┤
 *    │ 图片操作栏（尺寸/浏览数/点赞数）                   │
 *    └───────────────────────────────────────────────────┘
 *
 *  关键设计：
 *    1. 图片展示区占 100% 宽度，不被面板挤压，杜绝图片被缩放/裁剪
 *    2. 所有工具面板通过 position: absolute 浮在图片外围，不占用文档流
 *    3. 用户可拖动工具面板到任意位置（标题栏为拖拽句柄，40px 可见边界约束）
 *    4. 不同面板激活时通过 key 变化重新挂载，重置初始位置
 *    5. 初始位置优先放置在图片展示区的右侧外围，若空间不足则置于左侧
 *    6. 叠加层与图片同处变换层，拖拽/缩放时同步移动
 *    7. 禁用浏览器原生图片拖拽，确保拖拽直接调整位置
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
import { PANEL_WIDTH } from './components/ToolPanel';
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

/** 面板与图片之间的水平间距（px） */
const PANEL_GAP = 16;
/** 面板与容器顶部的垂直偏移（px） */
const PANEL_TOP_OFFSET = 16;

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

  // rootRef：外层容器（position: relative，作为 absolute 面板的 offsetParent + 拖拽边界）
  const rootRef = useRef<HTMLDivElement>(null);
  // stageRef：图片展示区（包含图片内容 + 缩放容器），用于计算面板初始位置（放其右侧或左侧外围）
  const stageRef = useRef<HTMLDivElement>(null);
  // imageWrapperRef：直接包裹图片的容器（用于测量渲染尺寸 + 作为 overlay 定位基准）
  const imageWrapperRef = useRef<HTMLDivElement>(null);

  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // 面板初始位置（当首次激活面板时根据测量值确定，此后缓存直到工具切换）
  const [panelPosition, setPanelPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: PANEL_TOP_OFFSET,
  });

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

  /**
   * 计算工具面板初始位置：放置在图片展示区外围（优先右侧，若空间不足则左侧）
   * 坐标系 — 相对于 rootRef（外层容器，position: relative）
   */
  const computePanelPosition = useCallback(() => {
    const stage = stageRef.current;
    const root = rootRef.current;
    if (!stage || !root) return;

    const stageRect = stage.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();

    const stageLeft = stageRect.left - rootRect.left;
    const stageRight = stageRect.right - rootRect.left;
    const stageTop = stageRect.top - rootRect.top;
    const rootWidth = root.clientWidth;

    // 首选：图片展示区右侧外围 + 间距
    let x = stageRight + PANEL_GAP;
    // 如果右侧没有空间（root 宽度不够放整个面板），则放在左侧
    if (x + PANEL_WIDTH + PANEL_GAP > rootWidth) {
      x = stageLeft - PANEL_WIDTH - PANEL_GAP;
      // 左侧也超出边界（负 x）则贴容器左边缘 16px
      if (x < PANEL_GAP) x = Math.max(PANEL_GAP, stageRight - PANEL_WIDTH);
    }
    // Y 轴：展示区顶部 + 偏移
    const y = Math.max(PANEL_TOP_OFFSET, stageTop + PANEL_TOP_OFFSET);

    setPanelPosition({ x, y });
  }, []);

  // 每当激活/关闭面板类工具（activePanelTool 变化时），重新计算初始位置
  const activePanelTool: ToolId | null =
    Array.from(activeTools).find((id) =>
      TOOL_METAS.find((t) => t.id === id)?.mode === 'panel'
    ) ?? null;

  useEffect(() => {
    if (activePanelTool) {
      // DOM 可能尚未挂载，下一次绘制后再测量（图片尚未加载时 stageRect 为 0 也是 OK 的，后续 resize 会修正）
      computePanelPosition();
      // 当图片加载完成尺寸变化后，位置也要重算（否则面板会紧贴原 stage 边界，图片变大后可能压到图片上）
      const t = window.setTimeout(computePanelPosition, 150);
      return () => window.clearTimeout(t);
    }
  }, [activePanelTool, computePanelPosition]);

  // 容器尺寸变化也调整位置（仅当当前有激活面板时）
  useEffect(() => {
    if (!activePanelTool) return;
    const root = rootRef.current;
    if (!root) return;
    const obs = new ResizeObserver(() => computePanelPosition());
    obs.observe(root);
    return () => obs.disconnect();
  }, [activePanelTool, computePanelPosition]);

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

  // 传递给所有面板工具的通用 props
  const panelCommonProps = {
    visible: true,
    initialX: panelPosition.x,
    initialY: panelPosition.y,
    boundsRef: rootRef,
  } as const;

  return (
    // 外层容器：position: relative 作为面板的 offsetParent
    // overflow: visible 允许浮动面板超出容器边界可视
    <div
      ref={rootRef}
      className="bg-white rounded-xl border border-gray-200 relative overflow-visible"
    >
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

      {/* 图片展示区（100% 全宽，不再给面板留空间，避免压缩图片） */}
      <div
        ref={stageRef}
        className="relative bg-gray-50"
        style={{ minHeight: '400px' }}
      >
        {/* 图片居中区域 */}
        <div className="flex items-center justify-center" style={{ maxHeight: '600px', overflow: 'hidden' }}>
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
      </div>

      {/* 浮动工具面板（通过 position: absolute，不占用文档流；key 切换工具时重挂载以重置初始位置） */}
      {activePanelTool && (
        <>
          {activePanelTool === 'histogram' && (
            <HistogramTool
              key="histogram"
              {...panelCommonProps}
              onClose={() => toggleTool('histogram')}
              pixels={pixels}
            />
          )}
          {activePanelTool === 'contrast' && (
            <ContrastTool
              key="contrast"
              {...panelCommonProps}
              onClose={() => toggleTool('contrast')}
              pixels={pixels}
            />
          )}
          {activePanelTool === 'saturation' && (
            <SaturationTool
              key="saturation"
              {...panelCommonProps}
              onClose={() => toggleTool('saturation')}
              pixels={pixels}
            />
          )}
          {activePanelTool === 'sharpness' && (
            <SharpnessTool
              key="sharpness"
              {...panelCommonProps}
              onClose={() => toggleTool('sharpness')}
              pixels={pixels}
            />
          )}
          {activePanelTool === 'colorTemp' && (
            <ColorTempTool
              key="colorTemp"
              {...panelCommonProps}
              onClose={() => toggleTool('colorTemp')}
              pixels={pixels}
            />
          )}
        </>
      )}

      {/* 图片操作栏（透传自调用方） */}
      {footer && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}
