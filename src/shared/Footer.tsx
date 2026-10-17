/**
 * 底部栏
 * 浅色主题页脚：品牌信息、导航链接与版权信息。
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * 底部栏组件
 * @returns 底部栏 JSX
 */
export function Footer(): ReactNode {
  return (
    <footer className="bg-white border-t border-gray-200 py-10 text-gray-600">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <p className="text-lg font-bold text-black">TLRphotos</p>
            <p className="mt-2 text-sm">航空摄影爱好者社区</p>
          </div>
          <div>
            <nav className="flex flex-col gap-2 text-sm">
              <Link to="/" className="hover:text-blue-800 transition-colors">首页</Link>
              <Link to="/gallery" className="hover:text-blue-800 transition-colors">作品集</Link>
              <Link to="/forum" className="hover:text-blue-800 transition-colors">论坛</Link>
              <Link to="/upload" className="hover:text-blue-800 transition-colors">上传</Link>
            </nav>
          </div>
          <div>
            <nav className="flex flex-col gap-2 text-sm">
              <Link to="/profile" className="hover:text-blue-800 transition-colors">个人设置</Link>
              <Link to="/column" className="hover:text-blue-800 transition-colors">专栏</Link>
              <Link to="/news" className="hover:text-blue-800 transition-colors">新闻</Link>
              <Link to="/about" className="hover:text-blue-800 transition-colors">关于我们</Link>
            </nav>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-gray-400">© 2026 TLRphotos 航空摄影工作室</p>
      </div>
    </footer>
  );
}
