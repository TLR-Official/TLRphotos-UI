/**
 * @file 移动端返回头部
 * @description
 *  固定顶部的移动端页面头：左侧返回按钮（44×44px 热区）、中间标题、右侧可选操作位。
 *  仅 ≤768px 渲染（md:hidden）。
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

interface MobileBackHeaderProps {
  /** 页面标题 */
  title: string;
  /** 右侧操作区（可选） */
  action?: ReactNode;
}

/**
 * 移动端返回头部组件
 * @param props - 标题与可选右侧操作
 * @returns 固定顶部导航 JSX
 */
export function MobileBackHeader({ title, action }: MobileBackHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white md:hidden">
      <div className="flex h-12 items-center">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="返回"
          className="flex h-11 w-11 items-center justify-center text-gray-700"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="m-0 flex-1 truncate text-center text-base font-medium text-black">
          {title}
        </h1>
        {/* 右侧操作位：无操作时以同宽占位保持标题居中 */}
        <div className="flex h-11 w-11 items-center justify-center">{action ?? null}</div>
      </div>
    </header>
  );
}
