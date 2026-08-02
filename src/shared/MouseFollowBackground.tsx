export function MouseFollowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden theme-bg-transition" aria-hidden="true">
      <div className="absolute inset-0 theme-bg-transition bg-gradient-to-br from-slate-100 via-white to-slate-50" />
      <GridTexture />
    </div>
  );
}

function GridTexture() {
  return (
    <div
      className="absolute inset-0 theme-bg-transition opacity-[0.04]"
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }}
    />
  );
}
