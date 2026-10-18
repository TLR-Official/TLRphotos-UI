/**
 * @file 站点公告横幅 TopBanner（V4.1.0）
 * @description
 *  站点顶部公告横幅（挂载于 Header 之前，正常文档流不遮挡导航）：
 *   - 拉取 GET /announcements；无公告或请求失败时整体静默隐藏（返回 null）；
 *   - 多条公告默认收起为最新一条横条（封面缩略图 + 标题），点击展开列出全部
 *     （每条：封面图[有则显示] + 标题 + 正文，正文保留换行）；
 *   - 关闭按钮按公告 id 记忆于 localStorage（key=topbanner-dismissed，
 *     JSON 数组含 id 与时间）；已记忆的公告不再展示，全部被记忆则收起为
 *     「展开公告」小按钮常驻，可重新展开（清除记忆）。
 *  配色克制：淡蓝底 / 深蓝文字，与三色体系一致。
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { getAnnouncements } from '../api/announcements';
import type { Announcement } from '../api/announcements';

/** 关闭记忆的 localStorage 键 */
const DISMISS_KEY = 'topbanner-dismissed';

/** 关闭记忆条目（公告 id + 关闭时间） */
interface DismissRecord {
  id: string;
  dismissed_at: string;
}

/** 读取关闭记忆（损坏/非法数据静默回退为空） */
function readDismissed(): DismissRecord[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is DismissRecord =>
        !!r && typeof r === 'object' && typeof (r as DismissRecord).id === 'string'
    );
  } catch {
    return [];
  }
}

/** 写入关闭记忆（存储不可用时静默跳过，仅影响本次会话记忆） */
function writeDismissed(records: DismissRecord[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(records));
  } catch {
    // 忽略写入失败（隐私模式/配额满）
  }
}

/**
 * 站点公告横幅组件
 * @returns 横幅 JSX；无公告 / 请求失败 / 全部已读时返回提示条或 null
 */
export function TopBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // 首次挂载：读取关闭记忆 + 拉取公告（失败静默隐藏）
  useEffect(() => {
    setDismissedIds(readDismissed().map((r) => r.id));
    getAnnouncements().then((res) => {
      if (res.success && res.data) setAnnouncements(res.data);
      setLoaded(true);
    });
  }, []);

  if (!loaded || announcements.length === 0) return null;

  const visible = announcements.filter((a) => !dismissedIds.includes(a.id));

  /** 关闭当前可见公告：按 id 写入记忆，全部被记忆后收起为小按钮 */
  const dismissVisible = () => {
    const now = new Date().toISOString();
    const existing = readDismissed();
    const merged = [
      ...existing.filter((r) => !visible.some((a) => a.id === r.id)),
      ...visible.map((a) => ({ id: a.id, dismissed_at: now })),
    ];
    writeDismissed(merged);
    setDismissedIds(merged.map((r) => r.id));
    setExpanded(false);
  };

  /** 重新展开：清除全部关闭记忆并列出所有公告 */
  const reopenAll = () => {
    writeDismissed([]);
    setDismissedIds([]);
    setExpanded(true);
  };

  // 全部公告已被关闭记忆：收起为常驻小按钮
  if (visible.length === 0) {
    return (
      <div className="bg-blue-50 border-b border-blue-100">
        <div className="max-w-7xl mx-auto px-4 py-1.5 flex justify-end">
          <button
            onClick={reopenAll}
            className="text-xs text-blue-700 hover:text-blue-800 hover:underline transition-colors"
          >
            展开公告
          </button>
        </div>
      </div>
    );
  }

  const latest = visible[0];

  return (
    <div className="bg-blue-50 border-b border-blue-200">
      <div className="max-w-7xl mx-auto px-4">
        {/* 收起横条：封面缩略图 + 最新公告标题 */}
        <div className="flex items-center gap-3 py-2.5">
          {latest.cover_url && (
            <img
              src={latest.cover_url}
              alt=""
              className="h-10 w-16 rounded object-cover flex-shrink-0"
            />
          )}
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-700 text-white">
            公告
          </span>
          <button
            onClick={() => setExpanded(true)}
            className="min-w-0 flex-1 text-left"
            aria-label="展开公告"
          >
            <span className="block truncate text-sm font-medium text-blue-900 hover:text-blue-700 transition-colors">
              {latest.title}
            </span>
          </button>
          {visible.length > 1 && (
            <span className="hidden sm:inline flex-shrink-0 text-xs text-blue-400">
              共 {visible.length} 条
            </span>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? '收起公告' : '展开公告'}
            className="flex-shrink-0 p-1 rounded text-blue-600 hover:bg-blue-100 transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={dismissVisible}
            aria-label="关闭公告"
            className="flex-shrink-0 p-1 rounded text-blue-400 hover:text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 展开列表：封面 + 标题 + 正文（保留换行） */}
        {expanded && (
          <div className="pb-4 pt-1 space-y-5">
            {visible.map((a) => (
              <article key={a.id}>
                {a.cover_url && (
                  <img
                    src={a.cover_url}
                    alt={a.title}
                    className="w-full max-h-56 object-cover rounded-lg mb-2"
                  />
                )}
                <h3 className="text-sm font-semibold text-blue-900">{a.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-blue-800 whitespace-pre-wrap break-words">
                  {a.content}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
