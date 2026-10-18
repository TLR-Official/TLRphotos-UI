/**
 * 公告管理页（V4.1.0）
 * 列表（含已下线，状态徽章）+ 新建/编辑表单（title/content/cover_url 可空）
 * + 上线/下线 toggle + 删除二次确认。仅 super / news_editor 可访问（页面级角色门 + 后端角色门）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Megaphone, ShieldAlert, RefreshCw } from 'lucide-react';
import { getAnnouncements, createAnnouncement, updateAnnouncement, toggleAnnouncement, deleteAnnouncement } from './api';
import type { Announcement, AdminUser } from './types';

/** 公告错误码 → 中文提示映射 */
const ANNOUNCEMENT_ERROR_MESSAGES: Record<string, string> = {
  ANNOUNCEMENT_FIELDS_INVALID: '字段校验失败：标题必填 ≤100 字、正文必填 ≤5000 字、封面 URL 须为 http(s) 链接 ≤500 字符',
  ANNOUNCEMENT_NOT_FOUND: '公告不存在或已被删除',
  ANNOUNCEMENT_DENIED: '无权限操作：公告管理仅对超级管理员与新闻编辑开放',
};

/**
 * 将接口错误映射为用户可读提示
 * @param message 接口 message
 * @param code 接口错误码
 * @param fallback 兜底文案
 */
const mapAnnouncementError = (message: string | undefined, code: string | undefined, fallback: string): string => {
  if (code && ANNOUNCEMENT_ERROR_MESSAGES[code]) return ANNOUNCEMENT_ERROR_MESSAGES[code];
  return message || fallback;
};

/**
 * 公告管理页组件
 * @param currentAdmin 当前登录管理员（页面级角色门）
 * @returns 公告管理 JSX（角色门占位 / 列表 + 表单）
 */
export function AnnouncementsPage({ currentAdmin }: { currentAdmin?: AdminUser | null }) {
  const allowed = currentAdmin?.role === 'super' || currentAdmin?.role === 'news_editor';

  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 表单状态：null=关闭，id 为空=新建，否则编辑
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);

  // 删除二次确认状态
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 拉取公告列表（含已下线） */
  const loadList = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    const res = await getAnnouncements(targetPage, 20);
    if (res.success && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } else {
      setError(mapAnnouncementError(res.message, undefined, '公告列表加载失败'));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) loadList(1);
  }, [allowed, loadList]);

  /** 打开新建表单 */
  const openCreate = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setCoverUrl('');
    setNotice(null);
    setFormOpen(true);
  };

  /** 打开编辑表单并回填 */
  const openEdit = (item: Announcement) => {
    setEditing(item);
    setTitle(item.title);
    setContent(item.content);
    setCoverUrl(item.cover_url || '');
    setNotice(null);
    setFormOpen(true);
  };

  /** 前端字段校验（与后端 ANNOUNCEMENT_FIELDS_INVALID 规则一致） */
  const validateForm = (): string | null => {
    const t = title.trim();
    const c = content.trim();
    if (!t || t.length > 100) return '标题必填且不超过 100 字';
    if (!c || c.length > 5000) return '正文必填且不超过 5000 字';
    if (coverUrl.trim() && !/^https?:\/\/.+/.test(coverUrl.trim())) return '封面 URL 须以 http(s):// 开头';
    if (coverUrl.trim().length > 500) return '封面 URL 不超过 500 字符';
    return null;
  };

  /** 保存公告（新建或编辑，创建即上线） */
  const handleSave = async () => {
    if (saving) return;
    const err = validateForm();
    if (err) {
      setNotice({ type: 'error', text: err });
      return;
    }
    setSaving(true);
    const payload = { title: title.trim(), content: content.trim(), ...(coverUrl.trim() ? { cover_url: coverUrl.trim() } : {}) };
    const res = editing
      ? await updateAnnouncement(editing.id, payload)
      : await createAnnouncement(payload);
    if (res.success) {
      setNotice({ type: 'success', text: editing ? '公告已更新' : '公告已创建并上线' });
      setFormOpen(false);
      await loadList(page);
    } else {
      setNotice({ type: 'error', text: mapAnnouncementError(res.message, res.code, '保存失败') });
    }
    setSaving(false);
  };

  /** 上线/下线切换 */
  const handleToggle = async (item: Announcement) => {
    const res = await toggleAnnouncement(item.id);
    if (res.success) {
      setNotice({ type: 'success', text: res.data?.is_active ? '公告已上线' : '公告已下线' });
      await loadList(page);
    } else {
      setNotice({ type: 'error', text: mapAnnouncementError(res.message, res.code, '操作失败') });
    }
  };

  /** 删除公告（二次确认后执行） */
  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const res = await deleteAnnouncement(deleteTarget.id);
    if (res.success) {
      setNotice({ type: 'success', text: '公告已删除' });
      setDeleteTarget(null);
      await loadList(page);
    } else {
      setNotice({ type: 'error', text: mapAnnouncementError(res.message, res.code, '删除失败') });
      setDeleteTarget(null);
    }
    setDeleting(false);
  };

  // 页面级角色门：非 super/news_editor 显示无权限占位
  if (!allowed) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">公告管理</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <ShieldAlert className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-800 font-medium">无权限访问</p>
          <p className="text-sm text-gray-500 mt-2">公告管理仅对超级管理员与新闻编辑开放。</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">公告管理</h2>
        <div className="flex gap-2">
          <button
            onClick={() => loadList(page)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 rounded-lg text-sm transition-colors"
            title="刷新列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建公告
          </button>
        </div>
      </div>

      {/* 操作结果提示 */}
      {notice && (
        <div className={`mb-4 text-sm rounded-lg px-4 py-2 border ${
          notice.type === 'success'
            ? 'text-green-700 bg-green-50 border-green-200'
            : 'text-red-600 bg-red-50 border-red-200'
        }`}>
          {notice.text}
        </div>
      )}

      {/* 新建/编辑表单 */}
      {formOpen && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="text-base font-semibold text-gray-800 mb-4">{editing ? '编辑公告' : '新建公告'}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-700 mb-1">标题（必填，≤100 字）</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="公告标题"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">正文（必填，≤5000 字，支持换行）</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={5000}
                className="w-full h-40 p-3 border border-gray-300 rounded-lg text-gray-800 resize-y focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="公告正文内容..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">封面图 URL（可选，http(s) 链接，≤500 字符）</label>
              <input
                type="text"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                maxLength={500}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="https://..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setFormOpen(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors">取消</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors"
              >
                {saving ? '保存中...' : editing ? '保存修改' : '创建并上线'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 公告列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 text-center py-12">加载中...</p>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-12">{error}</p>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <Megaphone className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">暂无公告，点击右上角「新建公告」发布第一条。</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => (
              <div key={item.id} className="p-4 flex items-start gap-4">
                {/* 封面预览 */}
                {item.cover_url ? (
                  <img src={item.cover_url} alt={item.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-gray-200" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <Megaphone className="w-6 h-6 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800">{item.title}</p>
                    {/* 状态徽章 */}
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {item.is_active ? '上线中' : '已下线'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{item.content}</p>
                  <p className="text-xs text-gray-400 mt-1.5">创建于 {new Date(item.created_at).toLocaleString('zh-CN')} · 更新于 {new Date(item.updated_at).toLocaleString('zh-CN')}</p>
                </div>
                {/* 操作区 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => openEdit(item)}
                    title="编辑"
                    className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(item)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      item.is_active
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {item.is_active ? '下线' : '上线'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(item)}
                    title="删除"
                    className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分页 */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => loadList(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">第 {page} / {totalPages} 页（共 {total} 条）</span>
          <button
            onClick={() => loadList(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            下一页
          </button>
        </div>
      )}

      {/* 删除二次确认 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">删除公告</h3>
            <p className="text-sm text-gray-600 mb-1">确定删除「{deleteTarget.title}」？</p>
            <p className="text-xs text-gray-500 mb-5">删除后不可恢复，前台将立即不再展示该公告。</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg transition-colors">取消</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors">
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
