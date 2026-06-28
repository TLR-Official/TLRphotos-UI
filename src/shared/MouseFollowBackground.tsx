import { useEffect, useRef, useCallback } from 'react';

/**
 * 鼠标跟随动态背景组件
 * 使用多个渐变光球跟随鼠标移动，产生流体光效
 */
export function MouseFollowBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const rafRef = useRef<number>(0);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // 将鼠标位置归一化到 0-1 范围
    mouseRef.current.x = e.clientX / window.innerWidth;
    mouseRef.current.y = e.clientY / window.innerHeight;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const orbs = container.querySelectorAll<HTMLDivElement>('.bg-orb');
    // 每个光球的偏移系数，产生层次感
    const factors = [
      { x: 0.15, y: 0.12 },
      { x: -0.1, y: 0.18 },
      { x: 0.12, y: -0.08 },
      { x: -0.08, y: -0.14 },
      { x: 0.05, y: 0.1 },
    ];

    // 光球当前位置（平滑插值用）
    const current = factors.map(() => ({ x: 0.5, y: 0.5 }));

    const animate = () => {
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      orbs.forEach((orb, i) => {
        // 平滑插值，产生延迟跟随效果
        const speed = 0.03 + i * 0.008;
        current[i].x += (mx + factors[i].x - current[i].x) * speed;
        current[i].y += (my + factors[i].y - current[i].y) * speed;

        const px = current[i].x * 100;
        const py = current[i].y * 100;
        orb.style.background = `radial-gradient(
          600px circle at ${px}% ${py}%,
          var(--orb-color, rgba(120, 80, 255, 0.15)),
          transparent 40%
        )`;
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* 基底渐变 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-[#0c0a1a] to-slate-900" />

      {/* 流动光球 */}
      <div
        className="bg-orb absolute inset-0"
        style={{ '--orb-color': 'rgba(99, 102, 241, 0.12)' } as React.CSSProperties}
      />
      <div
        className="bg-orb absolute inset-0"
        style={{ '--orb-color': 'rgba(168, 85, 247, 0.10)' } as React.CSSProperties}
      />
      <div
        className="bg-orb absolute inset-0"
        style={{ '--orb-color': 'rgba(59, 130, 246, 0.08)' } as React.CSSProperties}
      />
      <div
        className="bg-orb absolute inset-0"
        style={{ '--orb-color': 'rgba(236, 72, 153, 0.06)' } as React.CSSProperties}
      />
      <div
        className="bg-orb absolute inset-0"
        style={{ '--orb-color': 'rgba(34, 211, 238, 0.05)' } as React.CSSProperties}
      />

      {/* 微弱网格纹理 */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
}
