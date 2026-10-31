/**
 * 论坛治理页（V4.3.0）
 * 两个 tab：
 * - 板块管理：板块列表（含停用）、编辑（名称/描述/图标/排序）、启停、删除（三大基础板块受保护）、
 *   「补齐基础板块」按钮按白名单幂等补齐缺失板块
 * - 帖子管理：板块筛选 + 最新/最热排序 + 分页，置顶切换、删除（级联，挂人机验证门）
 * 页面级角色门：super / zone_master / forum_moderator（与后端 /api/admin/forum/* 一致）。
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Pin, PinOff, Pencil, Trash2, Power, Plus } from 'lucide-react';
import {
  getAdminForumBoards,
  createForumBoard,
  updateForumBoard,
  deleteForumBoard,
  togglePinThread,
  deleteForumThread,
  getForumThreads,
  submitAdminVerification,
} from './api';
import { useHumanVerification } from '../shared/useHumanVerification';
import { UserTitleBadge } from '../shared/UserTitleBadge';
import type { AdminUser, ForumBoard, ForumThreadItem } from './types';

/** 三大基础板块（与后端 CANONICAL_FORUM_BOARDS 一致，用于「补齐基础板块」按钮） */
const CANONICAL_BOARD_NAMES = ['航空', '铁路', '公路'];

/** 每页数量 */
const PAGE_SIZE = 20;

/** 板块编辑表单状态 */
interface BoardForm {
  name: string;
  description: string;
  icon: string;
  sort_order: number;
}

/**
 * 论坛治理页组件
 * @param currentAdmin 当前登录管理员（页面级角色门）
 */
export function ForumPage({ currentAdmin }: { currentAdmin?: AdminUser | null }) {
  const role = currentAdmin?.role;
  const allowed = role === 'super' || role === 'zone_master' || role === 'forum_moderator';

  const { guard: verificationGuard, modal: verificationModal } = useHumanVerification({
    description: '删除论坛帖子为高危管理操作（级联删除全部评论），需完成人机验证。验证通过后 7 天内同一网络环境下无需重复验证。',
    submitFn: submitAdminVerification,
  });

  const [tab, setTab] = useState<'boards' | 'threads'>('boards');

  // ---------- 板块管理 ----------
  const [boards, setBoards] = useState<ForumBoard[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardNotice, setBoardNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // 编辑弹窗：目标板块 + 表单
  const [editTarget, setEditTarget] = useState<ForumBoard | null>(null);
  const [editForm, setEditForm] = useState<BoardForm>({ name: '', description: '', icon: '', sort_order: 0 });
  const [editSaving, setEditSaving] = useState(false);

  /** 拉取板块列表 */
  const fetchBoards = useCallback(async () => {
    setBoardsLoading(true);
    const result = await getAdminForumBoards();
    if (result.success && result.data) {
      setBoards(result.data);
    } else {
      setBoardNotice({ type: 'error', text: result.message || '获取板块列表失败' });
    }
    setBoardsLoading(false);
  }, []);

  // ---------- 帖子管理 ----------
  const [threads, setThreads] = useState<ForumThreadItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadPage, setThreadPage] = useState(1);
  const [threadBoardFilter, setThreadBoardFilter] = useState('');
  const [threadSort, setThreadSort] = useState<'latest' | 'hot'>('latest');
  const [threadNotice, setThreadNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  /** 拉取帖子列表 */
  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    const result = await getForumThreads({
      board_id: threadBoardFilter || undefined,
      sort: threadSort,
      page: threadPage,
      page_size: PAGE_SIZE,
    });
    if (result.success && result.data) {
      setThreads(result.data.items);
      setThreadsTotal(result.data.total);
    } else {
      setThreadNotice({ type: 'error', text: result.message || '获取帖子列表失败' });
    }
    setThreadsLoading(false);
  }, [threadBoardFilter, threadSort, threadPage]);

  useEffect(() => {
    if (allowed) fetchBoards();
  }, [allowed, fetchBoards]);

  useEffect(() => {
    if (allowed && tab === 'threads') fetchThreads();
  }, [allowed, tab, fetchThreads]);

  /** 打开板块编辑弹窗 */
  const openEdit = (board: ForumBoard) => {
    setEditTarget(board);
    setEditForm({
      name: board.name,
      description: board.description || '',
      icon: board.icon || '',
      sort_order: board.sort_order,
    });
  };

  /** 保存板块编辑 */
  const saveEdit = async () => {
    if (!editTarget || editSaving) return;
    if (!editForm.name.trim()) {
      setBoardNotice({ type: 'error', text: '板块名称不能为空' });
      return;
    }
    setEditSaving(true);
    const result = await updateForumBoard(editTarget.id, {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      icon: editForm.icon.trim(),
      sort_order: editForm.sort_order,
    });
    if (result.success) {
      setBoardNotice({ type: 'success', text: '板块已更新' });
      setEditTarget(null);
      await fetchBoards();
    } else {
      setBoardNotice({ type: 'error', text: result.message || '更新失败' });
    }
    setEditSaving(false);
  };

  /** 板块启停切换 */
  const handleToggleActive = async (board: ForumBoard) => {
    const action = board.is_active === 1 ? '停用' : '启用';
    if (!confirm(`确定${action}板块「${board.name}」？${board.is_active === 1 ? '停用后前台不再展示该板块。' : ''}`)) return;
    const result = await updateForumBoard(board.id, { is_active: board.is_active === 1 ? 0 : 1 });
    if (result.success) {
      setBoardNotice({ type: 'success', text: `板块已${action}` });
      await fetchBoards();
    } else {
      setBoardNotice({ type: 'error', text: result.message || `${action}失败` });
    }
  };

  /** 删除板块：三大基础板块受保护，其余板块下有帖子时后端 409 */
  const handleDeleteBoard = async (board: ForumBoard) => {
    if (!confirm(`确定删除板块「${board.name}」？该操作不可恢复。`)) return;
    const result = await deleteForumBoard(board.id);
    if (result.success) {
      setBoardNotice({ type: 'success', text: '板块已删除' });
      await fetchBoards();
    } else {
      setBoardNotice({ type: 'error', text: result.message || '删除失败' });
    }
  };

  /** 补齐三大基础板块（幂等：已存在的板块后端直接返回 existed=true） */
  const handleSeedBoards = async () => {
    setBoardsLoading(true);
    const missing = CANONICAL_BOARD_NAMES.filter((n) => !boards.some((b) => b.name === n));
    if (missing.length === 0) {
      setBoardNotice({ type: 'success', text: '三大基础板块均已存在，无需补齐' });
      setBoardsLoading(false);
      return;
    }
    for (const name of missing) {
      const result = await createForumBoard(name);
      if (!result.success) {
        setBoardNotice({ type: 'error', text: result.message || `创建板块「${name}」失败` });
        setBoardsLoading(false);
        return;
      }
    }
    setBoardNotice({ type: 'success', text: `已补齐 ${missing.length} 个基础板块：${missing.join('、')}` });
    await fetchBoards();
    setBoardsLoading(false);
  };

  /** 帖子置顶切换 */
  const handleTogglePin = async (thread: ForumThreadItem) => {
    if (operatingId) return;
    setOperatingId(thread.id);
    const result = await togglePinThread(thread.id);
    if (result.success) {
      setThreadNotice({ type: 'success', text: result.data?.is_pinned === 1 ? '已置顶' : '已取消置顶' });
      await fetchThreads();
    } else {
      setThreadNotice({ type: 'error', text: result.message || '操作失败' });
    }
    setOperatingId(null);
  };

  /** 删除帖子：confirm + 人机验证门（级联删除全部评论） */
  const handleDeleteThread = async (thread: ForumThreadItem) => {
    if (operatingId) return;
    if (!confirm(`确定删除帖子「${thread.title}」？\n该操作将级联删除其全部评论，不可恢复。`)) return;
    setOperatingId(thread.id);
    const result = await verificationGuard('admin_user_admin', () => deleteForumThread(thread.id));
    if (result.success) {
      setThreadNotice({ type: 'success', text: '帖子已删除' });
      await fetchThreads();
    } else {
      setThreadNotice({ type: 'error', text: result.message || '删除失败' });
    }
    setOperatingId(null);
  };

  /** 时间格式化 */
  const formatTime = (s: string | null) => (s ? new Date(s).toLocaleString('zh-CN') : '-');

  if (!allowed) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">论坛治理</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-gray-800 font-medium">无权访问</p>
          <p className="text-sm text-gray-500 mt-2">仅超级管理员、分区主管或论坛管理员可进行论坛治理</p>
        </div>
      </div>
    );
  }

  const boardNameMap = new Map(boards.map((b) => [b.id, b.name]));
  const totalPages = Math.max(1, Math.ceil(threadsTotal / PAGE_SIZE));

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">论坛治理</h2>

      {/* tab 切换 */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'boards', label: '板块管理' },
          { key: 'threads', label: '帖子管理' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ============ 板块管理 ============ */}
      {tab === 'boards' && (
        <div>
          {boardNotice && (
            <div className={`mb-4 text-sm rounded-lg px-4 py-2 border ${
              boardNotice.type === 'success'
                ? 'text-green-700 bg-green-50 border-green-200'
                : 'text-red-600 bg-red-50 border-red-200'
            }`}>
              {boardNotice.text}
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              板块结构固定为航空 / 铁路 / 公路三大类，仅允许调整名称、描述、排序与启停
            </p>
            <button
              onClick={handleSeedBoards}
              disabled={boardsLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              补齐基础板块
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {boardsLoading ? (
              <div className="py-16 text-center text-sm text-gray-500">加载中...</div>
            ) : boards.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">暂无板块，点击右上角「补齐基础板块」创建</div>
            ) : (
              boards.map((b) => (
                <div key={b.id} className="px-5 py-4 border-b border-gray-100 last:border-b-0 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{b.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        b.is_active === 1
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-gray-100 text-gray-500 border-gray-200'
                      }`}>
                        {b.is_active === 1 ? '已启用' : '已停用'}
                      </span>
                      {CANONICAL_BOARD_NAMES.includes(b.name) && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                          基础板块
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">{b.description || '暂无描述'}</p>
                    <p className="text-xs text-gray-400 mt-1">排序 {b.sort_order} · {b.thread_count} 篇帖子</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(b)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      编辑
                    </button>
                    <button
                      onClick={() => handleToggleActive(b)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        b.is_active === 1
                          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                          : 'text-green-700 bg-green-50 hover:bg-green-100'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {b.is_active === 1 ? '停用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleDeleteBoard(b)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ============ 帖子管理 ============ */}
      {tab === 'threads' && (
        <div>
          {threadNotice && (
            <div className={`mb-4 text-sm rounded-lg px-4 py-2 border ${
              threadNotice.type === 'success'
                ? 'text-green-700 bg-green-50 border-green-200'
                : 'text-red-600 bg-red-50 border-red-200'
            }`}>
              {threadNotice.text}
            </div>
          )}

          {/* 筛选条 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select
              value={threadBoardFilter}
              onChange={(e) => { setThreadBoardFilter(e.target.value); setThreadPage(1); }}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 focus:outline-none focus:border-blue-500"
            >
              <option value="">全部板块</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {([
                { key: 'latest', label: '最新' },
                { key: 'hot', label: '最热' },
              ] as const).map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setThreadSort(s.key); setThreadPage(1); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    threadSort === s.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 ml-auto">共 {threadsTotal} 篇帖子</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {threadsLoading ? (
              <div className="py-16 text-center text-sm text-gray-500">加载中...</div>
            ) : threads.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-400">暂无帖子</div>
            ) : (
              threads.map((t) => (
                <div key={t.id} className="px-5 py-4 border-b border-gray-100 last:border-b-0 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 truncate">{t.title}</span>
                      {t.is_pinned === 1 && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                          置顶
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {t.author_name}
                      <UserTitleBadge title={t.author_title} />
                      {' '}· {boardNameMap.get(t.board_id) || t.board_id}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {t.reply_count} 回复 · {t.like_count} 点赞 · {t.view_count} 浏览 · 发布于 {formatTime(t.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTogglePin(t)}
                      disabled={operatingId === t.id}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                        t.is_pinned === 1
                          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                          : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                      }`}
                    >
                      {t.is_pinned === 1 ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                      {t.is_pinned === 1 ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      onClick={() => handleDeleteThread(t)}
                      disabled={operatingId === t.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button
                onClick={() => setThreadPage((p) => Math.max(1, p - 1))}
                disabled={threadPage <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> 上一页
              </button>
              <span className="text-sm text-gray-500">{threadPage} / {totalPages}</span>
              <button
                onClick={() => setThreadPage((p) => Math.min(totalPages, p + 1))}
                disabled={threadPage >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
              >
                下一页 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 板块编辑弹窗 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !editSaving && setEditTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">编辑板块</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">名称</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">描述</label>
                <input
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">图标</label>
                <input
                  value={editForm.icon}
                  onChange={(e) => setEditForm((f) => ({ ...f, icon: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">排序（越小越靠前）</label>
                <input
                  type="number"
                  value={editForm.sort_order}
                  onChange={(e) => setEditForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
                className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {verificationModal}
    </div>
  );
}

export default ForumPage;
