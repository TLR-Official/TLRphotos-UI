/**
 * @file SharpnessTool - 锐度评估工具
 * @description
 *  基于拉普拉斯方差（Laplacian Variance）量化图像锐度。
 *  方差越大 → 边缘越丰富 → 图像越清晰。
 *  分级：excellent(>500) / good(200-500) / fair(80-200) / blurry(<80)
 */

import { ToolPanel, MetricCard, ReferenceBar } from '../components/ToolPanel';
import { useSharpness, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface SharpnessToolProps {
  visible: boolean;
  onClose: () => void;
  pixels: UseImagePixelsResult;
}

const RATING_CONFIG: Record<string, { text: string; color: string }> = {
  excellent: { text: '优秀', color: 'text-green-600' },
  good: { text: '良好', color: 'text-blue-600' },
  fair: { text: '一般', color: 'text-yellow-600' },
  blurry: { text: '模糊', color: 'text-red-600' },
};

export function SharpnessTool({ visible, onClose, pixels }: SharpnessToolProps) {
  const sharpness = useSharpness(pixels.imageData);

  return (
    <ToolPanel title="锐度评估" visible={visible} onClose={onClose}>
      {pixels.loading && <p className="text-sm text-gray-400">加载中...</p>}
      {sharpness && (
        <>
          <MetricCard
            label="拉普拉斯方差"
            value={sharpness.laplacianVariance.toFixed(0)}
            hint="数值越高越清晰"
          />
          <div className="rounded-lg p-4 mb-3 border border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">锐度评级</span>
              <span className={`text-lg font-bold ${RATING_CONFIG[sharpness.rating].color}`}>
                {RATING_CONFIG[sharpness.rating].text}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">锐度参考标准</p>
            <ReferenceBar
              value={sharpness.laplacianVariance}
              max={700}
              thresholds={{ low: 80, high: 200 }}
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>模糊 (&lt;80)</span>
              <span>一般 (80-200)</span>
              <span>良好 (200-500)</span>
              <span>优秀 (&gt;500)</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            拉普拉斯方差通过二阶导数检测图像边缘强度。
            航空摄影中，动态模糊或对焦失误会导致方差显著降低。
          </p>
        </>
      )}
    </ToolPanel>
  );
}
