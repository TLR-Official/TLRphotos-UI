/**
 * @file UserTitleBadge.tsx
 * @description V4.7.0 用户称号小标签。邀请码注册成功后由服务端授予称号，
 *              全站所有用户名展示处统一使用本组件，紧跟用户名后方渲染。
 *              称号为空（未使用邀请码 / 老用户）时返回 null，不占位、不影响原有布局。
 */

interface UserTitleBadgeProps {
  /** 称号文案；空值不渲染 */
  title?: string | null;
  className?: string;
}

export function UserTitleBadge({ title, className = '' }: UserTitleBadgeProps) {
  if (!title) return null;
  return (
    <span
      className={`ml-1 inline-flex shrink-0 items-center whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 align-middle text-[10px] font-medium leading-none text-blue-700 ${className}`}
    >
      {title}
    </span>
  );
}
