/**
 * @file 帖子流分页条（论坛首页 / 板块页共用）
 * @description
 *  桌面端保持原居中布局；移动端（≤768px）上/下一页按钮通栏均分宽度，
 *  热区加高至 44px（py-3 + text-sm 行高 20px）。
 */
interface ThreadPaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

export function ThreadPagination({ page, totalPages, onChange }: ThreadPaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center gap-2 mt-6">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="px-3 py-1 rounded bg-slate-100 text-slate-600 disabled:opacity-40 max-md:flex-1 max-md:py-3"
      >
        上一页
      </button>
      <span className="px-3 py-1 text-sm text-slate-500 max-md:flex max-md:items-center max-md:justify-center">
        {page} / {totalPages}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="px-3 py-1 rounded bg-slate-100 text-slate-600 disabled:opacity-40 max-md:flex-1 max-md:py-3"
      >
        下一页
      </button>
    </div>
  );
}
