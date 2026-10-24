/**
 * @file 管理端移动端只读提示条
 * @description
 *  仅 ≤768px 渲染：浅蓝底深蓝左边框提示「移动端为只读视图，复杂操作请使用桌面端处理」。
 *  用于含复杂表单的管理页面（封禁/审核/裁决/编辑器），不删除任何功能，仅做提示。
 */
import { useIsMobile } from '../shared/useIsMobile';

/**
 * 移动端只读提示条
 * @returns 移动端渲染提示条；桌面端返回 null（零渲染零影响）
 */
export function MobileReadOnlyNotice() {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  return (
    <div
      role="note"
      className="mb-4 rounded-lg border-l-4 border-l-blue-700 bg-blue-50 px-4 py-3 text-sm text-blue-800"
    >
      移动端为只读视图，复杂操作请使用桌面端处理
    </div>
  );
}
