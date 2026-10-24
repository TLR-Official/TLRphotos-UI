/**
 * @file MobileZoomableImage.tsx
 * @description 移动端照片手势缩放容器（仅 ≤768px / 触摸设备由父层挂载，桌面端不渲染）：
 *   - 双击：1x ↔ 2.5x 切换，以双击点为缩放中心；
 *   - 双指 pinch：1x ~ 4x 实时跟随，锚点为两指中点；
 *   - 缩放 >1x 时容器 touch-action: none 禁止页面滚动，单指/双指拖动平移；
 *   - 恢复 1x 时位移自动归零（边界收敛逻辑保证）；
 *   - transform 150ms 过渡，手势进行中关闭过渡保证跟随性。
 *   未过审「审核中」占位图由父层直接渲染 CachedImage，不经过本组件，天然无手势。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CachedImage } from '../../components/CachedImage';

/** 缩放边界常量 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
/** 双击判定：两次点击间隔与位移阈值 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 48;
/** 单击判定：按下时长与位移阈值（超过视为拖动/长按，不计入双击） */
const TAP_MAX_MS = 350;
const TAP_MOVE_SLOP_PX = 6;

interface Transform {
  s: number;
  x: number;
  y: number;
}

export interface MobileZoomableImageProps {
  src: string;
  alt: string;
  status?: string;
  authToken?: string;
}

/** 手势会话（不进 React 渲染流，避免高频 state 抖动） */
interface GestureSession {
  pointers: Map<number, { x: number; y: number }>;
  mode: 'idle' | 'pan' | 'pinch';
  startDist: number;
  startScale: number;
  /** pinch 锚点（图像坐标系，缩放时保持锚点在屏幕上的位置不变） */
  anchorImgX: number;
  anchorImgY: number;
  startTx: number;
  startTy: number;
  downX: number;
  downY: number;
  downTime: number;
  moved: boolean;
  lastTap: { t: number; x: number; y: number };
}

export function MobileZoomableImage({ src, alt, status, authToken }: MobileZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<Transform>({ s: MIN_SCALE, x: 0, y: 0 });
  // gesturing：手势进行中标记，用于关闭 CSS transition 保证实时跟随
  const [gesturing, setGesturing] = useState(false);
  // tf 的 ref 镜像：供原生监听器与事件回调读取最新值，避免闭包陈旧
  const tfRef = useRef(tf);
  tfRef.current = tf;

  const session = useRef<GestureSession>({
    pointers: new Map(),
    mode: 'idle',
    startDist: 0,
    startScale: 1,
    anchorImgX: 0,
    anchorImgY: 0,
    startTx: 0,
    startTy: 0,
    downX: 0,
    downY: 0,
    downTime: 0,
    moved: false,
    lastTap: { t: 0, x: 0, y: 0 },
  });

  // rAF 批处理：pointermove 高频事件合并到每帧至多一次 setState
  const rafId = useRef(0);
  const pendingTf = useRef<Transform | null>(null);
  const scheduleSetTf = useCallback((next: Transform) => {
    pendingTf.current = next;
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        if (pendingTf.current) setTf(pendingTf.current);
        pendingTf.current = null;
      });
    }
  }, []);
  useEffect(() => () => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
  }, []);

  /**
   * 边界收敛：缩放后图片不大于容器时居中，大于容器时限制平移不露出空白；
   * s=1 时图片与容器同尺寸，x/y 自然归零（位移复位）。
   */
  const clampTf = useCallback((next: Transform): Transform => {
    const el = containerRef.current;
    if (!el) return next;
    const W = el.offsetWidth;
    const H = el.offsetHeight;
    if (!W || !H) return next;
    const sw = W * next.s;
    const sh = H * next.s;
    return {
      s: next.s,
      x: sw <= W ? (W - sw) / 2 : Math.min(0, Math.max(W - sw, next.x)),
      y: sh <= H ? (H - sh) / 2 : Math.min(0, Math.max(H - sh, next.y)),
    };
  }, []);

  /** 将指针屏幕坐标换算为容器内局部坐标（容器自身不参与 transform） */
  const localPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // 非 passive touchmove：双指或已缩放时阻断浏览器默认滚动/捏合缩放
  // （scale=1 且单指时保持 touch-action: pan-y 原生纵向滚动体验）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 || tfRef.current.s > MIN_SCALE) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅处理触屏/手写笔；鼠标事件放行给桌面端逻辑
    if (e.pointerType === 'mouse') return;
    const p = localPoint(e.clientX, e.clientY);
    const s = session.current;
    s.pointers.set(e.pointerId, p);
    containerRef.current?.setPointerCapture(e.pointerId);

    if (s.pointers.size === 1) {
      s.mode = tfRef.current.s > MIN_SCALE ? 'pan' : 'idle';
      s.downX = p.x;
      s.downY = p.y;
      s.startTx = tfRef.current.x;
      s.startTy = tfRef.current.y;
      s.downTime = Date.now();
      s.moved = false;
      if (s.mode === 'pan') setGesturing(true);
    } else if (s.pointers.size === 2) {
      // 进入 pinch：记录初始距离/缩放，并把当前两指中点换算为图像坐标锚点
      const [a, b] = [...s.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const cur = tfRef.current;
      s.mode = 'pinch';
      s.startDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      s.startScale = cur.s;
      s.anchorImgX = (midX - cur.x) / cur.s;
      s.anchorImgY = (midY - cur.y) / cur.s;
      s.moved = true; // 双指操作不计入后续双击判定
      setGesturing(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (!s.pointers.has(e.pointerId)) return;
    const p = localPoint(e.clientX, e.clientY);
    s.pointers.set(e.pointerId, p);
    if (Math.hypot(p.x - s.downX, p.y - s.downY) > TAP_MOVE_SLOP_PX) s.moved = true;

    if (s.mode === 'pinch' && s.pointers.size >= 2) {
      const [a, b] = [...s.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (s.startScale * dist) / s.startDist));
      // 保持锚点不动：T = mid - anchor * scale
      scheduleSetTf(
        clampTf({ s: scale, x: midX - s.anchorImgX * scale, y: midY - s.anchorImgY * scale })
      );
    } else if (s.mode === 'pan' && s.pointers.size === 1) {
      scheduleSetTf(
        clampTf({ s: tfRef.current.s, x: s.startTx + p.x - s.downX, y: s.startTy + p.y - s.downY })
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (!s.pointers.has(e.pointerId)) return;
    s.pointers.delete(e.pointerId);

    // pinch 抬起一指后剩余一指：无缝转为平移（重新锚定起点防跳变）
    if (s.pointers.size === 1 && s.mode === 'pinch') {
      const rest = [...s.pointers.values()][0];
      s.mode = tfRef.current.s > MIN_SCALE ? 'pan' : 'idle';
      s.downX = rest.x;
      s.downY = rest.y;
      s.startTx = tfRef.current.x;
      s.startTy = tfRef.current.y;
      return;
    }
    if (s.pointers.size > 0) return;

    const wasPinch = s.mode === 'pinch';
    s.mode = 'idle';
    setGesturing(false);

    // 双击检测：单指短按且位移小（pinch 结束后不触发）
    const now = Date.now();
    if (!wasPinch && !s.moved && now - s.downTime < TAP_MAX_MS) {
      const p = localPoint(e.clientX, e.clientY);
      const lt = s.lastTap;
      if (now - lt.t < DOUBLE_TAP_MS && Math.hypot(p.x - lt.x, p.y - lt.y) < DOUBLE_TAP_SLOP_PX) {
        s.lastTap = { t: 0, x: 0, y: 0 };
        const cur = tfRef.current;
        if (cur.s > 1.01) {
          // 还原：位移随 s=1 自动归零
          setTf({ s: MIN_SCALE, x: 0, y: 0 });
        } else {
          // 以双击点为缩放中心放大到 2.5x
          const imgX = (p.x - cur.x) / cur.s;
          const imgY = (p.y - cur.y) / cur.s;
          setTf(
            clampTf({
              s: DOUBLE_TAP_SCALE,
              x: p.x - imgX * DOUBLE_TAP_SCALE,
              y: p.y - imgY * DOUBLE_TAP_SCALE,
            })
          );
        }
        return;
      }
      s.lastTap = { t: now, x: p.x, y: p.y };
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    session.current.pointers.delete(e.pointerId);
    if (session.current.pointers.size === 0) {
      session.current.mode = 'idle';
      setGesturing(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none overflow-hidden"
      style={{ touchAction: tf.s > MIN_SCALE ? 'none' : 'pan-y' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        className="w-full will-change-transform"
        style={{
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`,
          transformOrigin: '0 0',
          transition: gesturing ? 'none' : 'transform 150ms ease',
        }}
      >
        <CachedImage
          src={src}
          alt={alt}
          status={status}
          authToken={authToken}
          draggable={false}
          className="block h-auto w-full"
        />
      </div>
      {/* 缩放指示徽章 */}
      {tf.s > MIN_SCALE && (
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {tf.s.toFixed(1)}x
        </span>
      )}
    </div>
  );
}
