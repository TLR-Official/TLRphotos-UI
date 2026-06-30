import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from './ThemeContext';

export function MouseFollowBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5, active: false });
  const timeRef = useRef(0);
  const rafRef = useRef<number>(0);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    mouseRef.current.x = e.clientX / window.innerWidth;
    mouseRef.current.y = e.clientY / window.innerHeight;
    mouseRef.current.active = true;
  }, []);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current.active = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseleave', handleMouseLeave, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const isDark = theme === 'dark';
    const baseColor = isDark ? 'rgba(168, 85, 247, ' : 'rgba(79, 70, 229, ';
    const mouseRippleColor = isDark ? 'rgba(255, 255, 255, ' : 'rgba(0, 0, 0, ';

    const lines = [];
    const lineCount = 48;

    for (let i = 0; i < lineCount; i++) {
      lines.push({
        baseX: Math.random(),
        baseY: Math.random(),
        speedX: 0.0004 + Math.random() * 0.0018,
        speedY: 0.0003 + Math.random() * 0.0014,
        radiusX: 0.08 + Math.random() * 0.12,
        radiusY: 0.06 + Math.random() * 0.1,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        length: 60 + Math.random() * 140,
        width: 0.8 + Math.random() * 1.5,
        opacity: isDark ? (0.25 + Math.random() * 0.45) : (0.4 + Math.random() * 0.4),
        hueOffset: i * 10,
        currentX: 0.5,
        currentY: 0.5,
      });
    }

    const animate = () => {
      timeRef.current += 0.016;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const mx = mouseRef.current.x * canvas.width;
      const my = mouseRef.current.y * canvas.height;
      const mouseActive = mouseRef.current.active;

      lines.forEach((line) => {
        const autoX = line.baseX * canvas.width + Math.sin(timeRef.current * line.speedX * 60 + line.phaseX) * line.radiusX * canvas.width;
        const autoY = line.baseY * canvas.height + Math.cos(timeRef.current * line.speedY * 60 + line.phaseY) * line.radiusY * canvas.height;

        let targetX = autoX;
        let targetY = autoY;

        if (mouseActive) {
          const distX = autoX - mx;
          const distY = autoY - my;
          const dist = Math.sqrt(distX * distX + distY * distY);
          const maxDist = canvas.width * 0.4;
          const interference = Math.max(0, 1 - dist / maxDist) * 0.35;
          targetX += distX * interference;
          targetY += distY * interference;
        }

        const smoothSpeed = 0.04;
        line.currentX += (targetX - line.currentX) * smoothSpeed;
        line.currentY += (targetY - line.currentY) * smoothSpeed;

        const angle = timeRef.current * 2 + line.phaseX;
        const endX = line.currentX + Math.cos(angle) * line.length;
        const endY = line.currentY + Math.sin(angle) * line.length;

        const gradient = ctx.createLinearGradient(line.currentX, line.currentY, endX, endY);
        const alpha = isDark ? line.opacity * 0.7 : line.opacity * 0.8;
        gradient.addColorStop(0, baseColor + alpha + ')');
        gradient.addColorStop(0.5, baseColor + (alpha * 0.9) + ')');
        gradient.addColorStop(1, baseColor + '0)');

        ctx.beginPath();
        ctx.moveTo(line.currentX, line.currentY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = line.width;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(line.currentX, line.currentY, line.width * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = baseColor + (alpha * 0.9) + ')';
        ctx.fill();
      });

      if (mouseActive) {
        for (let i = 0; i < 3; i++) {
          const rippleRadius = (timeRef.current * 150 + i * 30) % 200;
          const rippleAlpha = Math.max(0, 0.15 - (rippleRadius / 200));
          ctx.beginPath();
          ctx.arc(mx, my, rippleRadius, 0, Math.PI * 2);
          ctx.strokeStyle = mouseRippleColor + rippleAlpha + ')';
          ctx.lineWidth = 2 - i * 0.5;
          ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden theme-bg-transition" aria-hidden="true">
      <div
        className={`absolute inset-0 theme-bg-transition ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-slate-950 via-[#0c0a1a] to-slate-900'
            : 'bg-gradient-to-br from-slate-100 via-white to-slate-50'
        }`}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ opacity: theme === 'dark' ? 0.85 : 1.0 }}
      />

      <GridTexture theme={theme} />
    </div>
  );
}

function GridTexture({ theme }: { theme: 'dark' | 'light' }) {
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';

  return (
    <div
      className={`absolute inset-0 theme-bg-transition ${
        theme === 'dark' ? 'opacity-[0.03]' : 'opacity-[0.04]'
      }`}
      style={{
        backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px),
                          linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }}
    />
  );
}