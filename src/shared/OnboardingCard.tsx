/**
 * @file 首页新手引导浮层（仅移动端）
 * @description
 *  未登录用户首次访问首页时展示的非全屏浮层卡片：
 *  - 仅移动端（useIsMobile）且未登录时渲染，桌面端零变化
 *  - 通过 useTip('onboarding', 1) 控制仅显示 1 次
 *  - 点遮罩 / 「注册」/「随便看看」均关闭；「注册」跳转 /auth
 */
import { useNavigate } from 'react-router-dom';
import { useUser } from './UserContext';
import { useIsMobile } from './useIsMobile';
import { useTip } from './useTip';

/**
 * 首页新手引导浮层
 * @returns 满足展示条件时渲染浮层卡片，否则返回 null
 */
export function OnboardingCard() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAuthenticated, isLoading } = useUser();
  const { visible, dismiss } = useTip('onboarding', 1);

  if (!isMobile || isLoading || isAuthenticated || !visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
      className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-[calc(88px+env(safe-area-inset-bottom))]"
    >
      <div className="absolute inset-0 bg-black/40" onClick={dismiss} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">传图需注册，浏览可随意</h2>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          注册账号即可上传作品、追踪审核进度；不注册也能自由浏览全部公开作品。
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => {
              dismiss();
              navigate('/auth');
            }}
            className="h-12 flex-1 rounded-xl bg-blue-700 font-medium text-white"
          >
            注册
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="h-12 flex-1 rounded-xl border border-gray-300 font-medium text-gray-700"
          >
            随便看看
          </button>
        </div>
      </div>
    </div>
  );
}
