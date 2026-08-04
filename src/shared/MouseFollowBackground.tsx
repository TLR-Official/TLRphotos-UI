/**
 * 鼠标跟随背景
 * 作为页面底层固定背景，由渐变底色与网格纹理叠加而成，不拦截指针事件。
 */
export function MouseFollowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden theme-bg-transition" aria-hidden="true">
      <div className="absolute inset-0 theme-bg-transition bg-gradient-to-br from-slate-100 via-white to-slate-50" />
      <GridTexture />
    </div>
  );
}

/** 网格纹理：通过两层线性渐变绘制 60px 间距的网格线，低透明度作为底纹 */
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
