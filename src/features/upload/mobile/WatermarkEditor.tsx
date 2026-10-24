/**
 * @file 移动端水印编辑器（上传 Step 3）
 * @description
 *  九宫格位置点选 + 三档字号 + 透明度滑杆 + 实时预览。
 *  预览字号公式 displaySize = size × max(渲染宽, 渲染高) / 1200，与桌面端 UploadPage
 *  及后端 imageService（scaleFactor = max(processedWidth, processedHeight) / 1200）
 *  完全同源，保证所见即所得；位置百分比以后端 text-anchor=middle 中心锚点对齐。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { watermarkPosToXY, WATERMARK_POS_LABELS, WATERMARK_SIZE_TIERS } from './watermark';
import type { WatermarkValue } from './watermark';
import { computeBandPreviewLayout } from '../../../shared/watermarkBand';

interface WatermarkEditorProps {
  /** 本地预览 ObjectURL */
  preview: string;
  /** 水印文字（固定，用户不可改） */
  text: string;
  /** 底部信息条第二行的著作权人（上传者用户名） */
  ownerName: string;
  /** 当前水印设置（受控） */
  value: WatermarkValue;
  /** 设置变更回调 */
  onChange: (value: WatermarkValue) => void;
}

/**
 * 移动端水印编辑器
 * @param props - 见 WatermarkEditorProps
 * @returns 水印设置与预览 JSX
 */
export function WatermarkEditor({ preview, text, ownerName, value, onChange }: WatermarkEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // 实际渲染的图片矩形（object-contain 后），用于 scaleFactor 与位置百分比换算
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // 原图原始尺寸，用于还原后端预览图坐标（底部信息条比例换算的基准）
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  /** 测量 object-contain 后图片的真实渲染矩形（与桌面端 UploadPage 同一算法） */
  const measure = useCallback(() => {
    const img = imgRef.current;
    const host = containerRef.current;
    if (!img || !host) return;
    const hostRect = host.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const ratio = Math.min(imgRect.width / nw, imgRect.height / nh);
    const drawnW = nw * ratio;
    const drawnH = nh * ratio;
    if (drawnW <= 0 || drawnH <= 0) return;
    setRect({
      x: (imgRect.width - drawnW) / 2 + (imgRect.left - hostRect.left),
      y: (imgRect.height - drawnH) / 2 + (imgRect.top - hostRect.top),
      width: drawnW,
      height: drawnH,
    });
    setNaturalSize({ width: nw, height: nh });
  }, []);

  // 图片源变化 / 窗口尺寸变化 → 重新测量
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, preview]);

  // 与后端/桌面端同源的预览字号线性缩放系数
  const fontScale = rect ? Math.max(rect.width, rect.height) / 1200 : 0;
  const displayFontSize = Math.max(1, Math.round(value.size * (fontScale || 1)));
  const pos = watermarkPosToXY(value.posIndex);
  const opacityPercent = Math.round(value.opacity * 100);

  // 底部信息条预览布局：比例与后端 imageService 完全同源（见 shared/watermarkBand.ts）
  const bandLayout = rect && naturalSize
    ? computeBandPreviewLayout({
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        renderedWidth: rect.width,
        siteName: text,
        ownerName,
      })
    : null;

  return (
    <div className="space-y-5">
      {/* 实时预览：水印文字按位置/字号/透明度叠加在实际渲染的图片矩形上 */}
      <div>
        <span className="text-sm font-medium text-gray-700">预览</span>
        <div
          ref={containerRef}
          className="relative mt-2 overflow-hidden rounded-lg bg-gray-100"
        >
          <img
            ref={imgRef}
            src={preview}
            alt="水印预览"
            className="block max-h-[38vh] w-full object-contain"
            onLoad={measure}
            onError={measure}
          />
          {rect && (
            <div
              className="pointer-events-none absolute select-none"
              style={{
                left: rect.x + (rect.width * pos.x) / 100,
                top: rect.y + (rect.height * pos.y) / 100,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <span
                className="whitespace-nowrap text-white"
                style={{
                  fontSize: `${displayFontSize}px`,
                  opacity: value.opacity,
                  // 与后端 SVG <text stroke=black stroke-width=1> 视觉对齐
                  WebkitTextStroke: `${Math.max(0.5, displayFontSize * 0.03)}px rgba(0,0,0,${value.opacity * 0.5})`,
                  textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
                  fontWeight: 600,
                }}
              >
                {text}
              </span>
            </div>
          )}
          {/* 底部信息条：在图片下方扩展等宽纯黑区域（不遮挡画面），条内两行白字居中 */}
          {rect && bandLayout && (
            <div
              className="relative select-none bg-black"
              style={{ marginLeft: rect.x, width: rect.width, height: bandLayout.height }}
            >
              <span
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-white"
                style={{
                  top: bandLayout.line1CenterY,
                  fontSize: `${bandLayout.line1FontSize}px`,
                  fontWeight: 600,
                }}
              >
                {bandLayout.line1}
              </span>
              <span
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-white"
                style={{
                  top: bandLayout.line2CenterY,
                  fontSize: `${bandLayout.line2FontSize}px`,
                  fontWeight: 400,
                }}
              >
                {bandLayout.line2}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 位置：九宫格点选 */}
      <div>
        <span className="text-sm font-medium text-gray-700">位置</span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {WATERMARK_POS_LABELS.map((label, index) => {
            const selected = value.posIndex === index;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...value, posIndex: index })}
                className={`flex h-12 items-center justify-center rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'border-blue-700 bg-blue-50 font-medium text-blue-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 字号：三档（基准 1200px 长边图像） */}
      <div>
        <span className="text-sm font-medium text-gray-700">字号</span>
        <div className="mt-2 flex gap-2">
          {WATERMARK_SIZE_TIERS.map((tier) => {
            const selected = value.size === tier.size;
            return (
              <button
                key={tier.label}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...value, size: tier.size })}
                className={`flex h-11 flex-1 items-center justify-center rounded-lg border text-sm transition-colors ${
                  selected
                    ? 'border-blue-700 bg-blue-50 font-medium text-blue-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600'
                }`}
              >
                {tier.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 透明度：滑杆 10%~100% */}
      <div>
        <span className="text-sm font-medium text-gray-700">透明度：{opacityPercent}%</span>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={opacityPercent}
          onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) / 100 })}
          aria-label="水印透明度"
          className="mt-2 h-11 w-full accent-blue-700"
        />
      </div>
    </div>
  );
}
