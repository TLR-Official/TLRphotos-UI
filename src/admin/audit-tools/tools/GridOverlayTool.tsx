/**
 * @file GridOverlayTool - 九宫格 + 对角线辅助线叠加
 * @description
 *  CSS overlay 绝对定位绘制：
 *  - 九宫格：3×3 等分网格线（两条水平 + 两条垂直）
 *  - 对角线：两条对角线 SVG
 *  辅助审核员判断构图是否符合三分法、黄金比例。
 */

interface GridOverlayToolProps {
  /** 是否显示九宫格 */
  showGrid: boolean;
  /** 是否显示对角线 */
  showDiagonal: boolean;
}

export function GridOverlayTool({ showGrid, showDiagonal }: GridOverlayToolProps) {
  return (
    <>
      {showGrid && (
        <div className="absolute inset-0 pointer-events-none z-10">
          {/* 垂直线：1/3 和 2/3 处 */}
          <div className="absolute top-0 bottom-0 left-1/3 w-px bg-purple-500/70" />
          <div className="absolute top-0 bottom-0 left-2/3 w-px bg-purple-500/70" />
          {/* 水平线：1/3 和 2/3 处 */}
          <div className="absolute left-0 right-0 top-1/3 h-px bg-purple-500/70" />
          <div className="absolute left-0 right-0 top-2/3 h-px bg-purple-500/70" />
          {/* 交叉点高亮 */}
          {[
            { left: '33.33%', top: '33.33%' },
            { left: '66.66%', top: '33.33%' },
            { left: '33.33%', top: '66.66%' },
            { left: '66.66%', top: '66.66%' },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full bg-purple-500 -translate-x-1/2 -translate-y-1/2"
              style={{ left: pos.left, top: pos.top }}
            />
          ))}
        </div>
      )}
      {showDiagonal && (
        <svg
          className="absolute inset-0 pointer-events-none z-10 w-full h-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(170, 59, 255, 0.6)" strokeWidth="0.3" strokeDasharray="2,1" />
          <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(170, 59, 255, 0.6)" strokeWidth="0.3" strokeDasharray="2,1" />
        </svg>
      )}
    </>
  );
}
