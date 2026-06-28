import { useNavigate } from 'react-router-dom';

export function Header() {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 glass py-2">
      <nav className="mx-auto max-w-7xl px-4 flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <img src="/favicon.svg" alt="TLRphotos Logo" className="h-24 w-24 object-contain" />
          <span className="text-lg font-medium text-white">航空摄影工作室</span>
        </button>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-slate-300 hover:text-white transition-colors"
          >
            作品集
          </button>
          <span className="text-slate-300">关于我们</span>
        </div>
      </nav>
    </header>
  );
}
