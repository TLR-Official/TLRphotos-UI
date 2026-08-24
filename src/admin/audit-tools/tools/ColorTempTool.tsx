/**
 * @file ColorTempTool - 色温分析工具
 * @description
 *  计算 RGB 通道均值与 R/B 比值，判断色温偏移方向：
 *  - warm（暖）：R/B > 1.15，偏黄红
 *  - cool（冷）：R/B < 0.87，偏蓝
 *  - neutral（中性）：0.87 ≤ R/B ≤ 1.15，白平衡正常
 */

import { ToolPanel, MetricCard } from '../components/ToolPanel';
import { useColorTemp, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface ColorTempToolProps {
  visible: boolean;
  onClose: () => void;
  pixels: UseImagePixelsResult;
  initialX?: number;
  initialY?: number;
  boundsRef?: React.RefObject<HTMLElement | null>;
}

const BIAS_CONFIG: Record<string, { text: string; color: string; bg: string }> = {
  warm: { text: '偏暖', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
  cool: { text: '偏冷', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  neutral: { text: '中性', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
};

export function ColorTempTool({ visible, onClose, pixels, initialX, initialY, boundsRef }: ColorTempToolProps) {
  const colorTemp = useColorTemp(pixels.imageData);

  return (
    <ToolPanel
      title="色温分析"
      visible={visible}
      onClose={onClose}
      initialX={initialX}
      initialY={initialY}
      boundsRef={boundsRef}
    >
      {pixels.loading && <p className="text-sm text-gray-400">加载中...</p>}
      {colorTemp && (
        <>
          <div className={`rounded-lg p-4 mb-3 border ${BIAS_CONFIG[colorTemp.bias].bg}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">白平衡判定</span>
              <span className={`text-lg font-bold ${BIAS_CONFIG[colorTemp.bias].color}`}>
                {BIAS_CONFIG[colorTemp.bias].text}
              </span>
            </div>
          </div>
          <MetricCard
            label="R/B 比值"
            value={colorTemp.ratio.toFixed(2)}
            hint=">1.15 暖，<0.87 冷"
          />
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg p-2 bg-red-50 border border-red-100 text-center">
              <p className="text-[10px] text-gray-500">R 均值</p>
              <p className="text-lg font-bold text-red-600">{colorTemp.rMean.toFixed(0)}</p>
            </div>
            <div className="rounded-lg p-2 bg-green-50 border border-green-100 text-center">
              <p className="text-[10px] text-gray-500">G 均值</p>
              <p className="text-lg font-bold text-green-600">{colorTemp.gMean.toFixed(0)}</p>
            </div>
            <div className="rounded-lg p-2 bg-blue-50 border border-blue-100 text-center">
              <p className="text-[10px] text-gray-500">B 均值</p>
              <p className="text-lg font-bold text-blue-600">{colorTemp.bMean.toFixed(0)}</p>
            </div>
          </div>
          {/* 色温条：冷到暖的渐变 + 当前位置标记 */}
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">色温偏移指示</p>
            <div className="relative h-4 rounded-full bg-gradient-to-r from-blue-500 via-white to-orange-500 border border-gray-200">
              <div
                className="absolute top-0 bottom-0 w-1 bg-gray-800 rounded-full shadow-lg"
                style={{
                  left: `${Math.min(100, Math.max(0, ((colorTemp.ratio - 0.5) / 1.5) * 100))}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>冷 (偏蓝)</span>
              <span>中性</span>
              <span>暖 (偏黄)</span>
            </div>
          </div>
        </>
      )}
    </ToolPanel>
  );
}
