import { useTheme } from './ThemeContext';

export function MouseFollowBackground() {
  const { theme } = useTheme();

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden theme-bg-transition" aria-hidden="true">
      <div
        className={`absolute inset-0 theme-bg-transition ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-slate-950 via-[#0c0a1a] to-slate-900'
            : 'bg-gradient-to-br from-slate-100 via-white to-slate-50'
        }`}
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