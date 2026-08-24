/**
 * @file ContrastTool - 对比度量化工具
 * @description
 *  显示亮度标准差、RMS 对比度、平均亮度、动态范围，
 *  并以参考标准条指示对比度等级（低/中/高）。
 */

import { ToolPanel, MetricCard, ReferenceBar } from '../components/ToolPanel';
import { useContrast, type UseImagePixelsResult } from '../hooks/useImagePixels';

interface ContrastToolProps {
  visible: boolean;
  onClose: () => void;
  pixels: UseImagePixelsResult;
  initialX?: number;
  initialY?: number;
  boundsRef?: React.RefObject<HTMLElement | null>;
}

export function ContrastTool({ visible, onClose, pixels, initialX, initialY, boundsRef }: ContrastToolProps) {
  const contrast = useContrast(pixels.imageData);

  return (
    <ToolPanel
      title="对比度量化"
      visible={visible}
      onClose={onClose}
      initialX={initialX}
      initialY={initialY}
      boundsRef={boundsRef}
    >
      {pixels.loading && <p className="text-sm text-gray-400">加载中...</p>}
      {contrast && (
        <>
          <MetricCard
            label="亮度标准差"
            value={contrast.stdDev.toFixed(1)}
            hint="数值越高，明暗差异越显著"
          />
          <MetricCard
            label="RMS 对比度"
            value={contrast.rms.toFixed(1)}
            unit="%"
            hint="均方根对比度，0-100%"
          />
          <MetricCard
            label="平均亮度"
            value={contrast.meanLuminance.toFixed(0)}
            unit="/ 255"
            hint="整体曝光水平"
          />
          <MetricCard
            label="动态范围"
            value={contrast.dynamicRange.toFixed(0)}
            hint="最亮与最暗像素之差"
          />

          <div className="mt-4">
            <p className="text-xs text-gray-500 mb-2">对比度等级参考</p>
            <ReferenceBar
              value={contrast.stdDev}
              max={120}
              thresholds={{ low: 40, high: 80 }}
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>低 (&lt;40)</span>
              <span>中 (40-80)</span>
              <span>高 (&gt;80)</span>
            </div>
          </div>
        </>
      )}
    </ToolPanel>
  );
}
