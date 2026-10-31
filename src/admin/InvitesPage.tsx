/**
 * @file InvitesPage.tsx（V4.7.0）
 * @description 邀请码管理页：新建/编辑邀请码（code 留空自动生成，绑定称号与可选航司、
 *  可用次数、到期时间、备注），列表展示用量与状态，支持启停与删除未使用码。
 *  仅 super 可访问（页面级角色门 + 后端 requireRole 门禁）。
 */
import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Ticket, RefreshCw } from 'lucide-react';
import { getInviteCodes, createInviteCode, updateInviteCode, deleteInviteCode } from './api';
import type { InviteCode, InviteCodePayload, AdminUser } from './types';

/** 每页条数（后端上限 100） */
const PAGE_SIZE = 20;

/** ISO 时间 → datetime-local 输入值（本地时区） */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 输入框通用样式 */
const inputClass =
  'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent';

/**
 * 邀请码管理页组件
 * @param currentAdmin 当前登录管理员（页面级角色门）
 * @returns 邀请码管理 JSX（角色门占位 / 搜索 + 表单 + 列表）
 */
export function InvitesPage({ currentAdmin }: { currentAdmin?: AdminUser | null }) {
  const allowed = currentAdmin?.role === 'super';

  const [items, setItems] = useState<InviteCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 搜索：输入值与已提交值分离，避免逐字请求
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');

  // 表单状态：null=新建，否则编辑
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InviteCode | null>(null);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [airline, setAirline] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  // 删除二次确认
  const [deleteTarget, setDeleteTarget] = useState<InviteCode | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** 拉取列表 */
  const loadList = useCallback(async (targetPage: number, kw: string) => {
    setLoading(true);
    setError('');
    const res = await getInviteCodes(targetPage, PAGE_SIZE, kw);
    if (res.success && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setPage(res.data.page);
    } else {
      setError(res.message || '邀请码列表加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) loadList(1, '');
  }, [allowed, loadList]);

  /** 重置表单并打开新建 */
  const openCreate = () => {
    setEditing(null);
    setCode('');
    setTitle('');
    setAirline('');
    setMaxUses('1');
    setExpiresAt('');
    setRemark('');
    setNotice(null);
    setFormOpen(true);
  };

  /** 回填并打开编辑（code 不可修改） */
  const openEdit = (item: InviteCode) => {
    setEditing(item);
    setCode(item.code);
    setTitle(item.title);
    setAirline(item.airline || '');
    setMaxUses(String(item.max_uses));
    setExpiresAt(toLocalInput(item.expires_at));
    setRemark(item.remark || '');
    setNotice(null);
    setFormOpen(true);
  };

  /** 前端字段校验（与后端规则一致） */
  const validateForm = (): string | null => {
    const t = title.trim();
    if (!t) return '请填写对应称号';
    if (t.length > 20) return '称号最多 20 个字符';
    if (airline.trim().length > 20) return '航司名称最多 20 个字符';
    const codeValue = code.trim();
    if (!editing && codeValue && !/^[A-Za-z0-9_-]{4,64}$/.test(codeValue)) {
      return '邀请码格式不正确（4-64 位字母/数字/下划线/连字符）';
    }
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 1 || uses > 10000) return '可用次数须为 1-10000 的整数';
    if (editing && uses < editing.used_count) return `可用次数不能小于已使用次数（${editing.used_count}）`;
    return null;
  };

  /** 保存（新建或编辑） */
  const handleSave = async () => {
    if (saving) return;
    const err = validateForm();
    if (err) {
      setNotice({ type: 'error', text: err });
      return;
    }
    setSaving(true);
    const payload: InviteCodePayload = {
      title: title.trim(),
      airline: airline.trim(),
      max_uses: Number(maxUses),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      remark: remark.trim(),
    };
    if (!editing && code.trim()) payload.code = code.trim();
    const res = editing
      ? await updateInviteCode(editing.id, payload)
      : await createInviteCode(payload);
    if (res.success) {
      setNotice({ type: 'success', text: editing ? '邀请码已更新' : `邀请码已创建${res.data ? `：${res.data.code}` : ''}` });
      setFormOpen(false);
      await loadList(editing ? page : 1, keyword);
    } else {
      setNotice({ type: 'error', text: res.message || '保存失败' });
    }
    setSaving(false);
  };

  /** 启用/停用切换 */
  const handleToggle = async (item: InviteCode) => {
    const res = await updateInviteCode(item.id, { is_active: item.is_active === 1 ? false : true });
    if (res.success) {
      setNotice({ type: 'success', text: item.is_active === 1 ? '邀请码已停用' : '邀请码已启用' });
      await loadList(page, keyword);
    } else {
      setNotice({ type: 'error', text: res.message || '操作失败' });
    }
  };

  /** 删除（仅未使用，二次确认后执行） */
  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const res = await deleteInviteCode(deleteTarget.id);
    if (res.success) {
      setNotice({ type: 'success', text: '邀请码已删除' });
      setDeleteTarget(null);
      await loadList(page, keyword);
    } else {
      setNotice({ type: 'error', text: res.message || '删除失败' });
      setDeleteTarget(null);
    }
    setDeleting(false);
  };

  /** 提交搜索（回到第一页） */
  const submitSearch = () => {
    const kw = keywordInput.trim();
    setKeyword(kw);
    loadList(1, kw);
  };

  // 页面级角色门
  if (!allowed) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">邀请码管理</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <Ticket className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">邀请码管理仅对超级管理员开放</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-800">邀请码管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadList(page, keyword)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 bg-white hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建邀请码
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
            notice.type === 'success'
              ? 'bg-blue-50 border-blue-200 text-blue-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex gap-2 max-md:flex-col">
        <input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSearch();
          }}
          placeholder="搜索邀请码 / 称号 / 航司"
          className={inputClass}
        />
        <button
          onClick={submitSearch}
          className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm hover:bg-gray-200 transition-colors shrink-0"
        >
          搜索
        </button>
      </div>

      {/* 新建/编辑表单 */}
      {formOpen && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{editing ? '编辑邀请码' : '新建邀请码'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">邀请码（留空自动生成）</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={!!editing}
                maxLength={64}
                placeholder="如 AIRCRAFT2026"
                className={`${inputClass} ${editing ? 'bg-gray-50 text-gray-500' : ''}`}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">对应称号（必填，≤20 字）</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={20}
                placeholder="如 航空摄影师"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">关联航司（选填，≤20 字）</label>
              <input
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                maxLength={20}
                placeholder="如 中国东方航空"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">可用次数（1-10000）</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">到期时间（留空永久有效）</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">备注（选填）</label>
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                maxLength={200}
                placeholder="发放渠道 / 用途说明"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                saving ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-700 hover:bg-blue-800'
              }`}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {error && <div className="px-4 py-3 text-sm text-red-600 bg-red-50 border-b border-red-200">{error}</div>}
        {loading ? (
          <div className="p-10 text-center text-gray-500 text-sm">加载中...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">暂无邀请码</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">邀请码</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">称号</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">航司</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">已用 / 上限</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">状态</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">到期</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">创建时间</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-gray-200">
                    <td className="px-4 py-3 font-mono text-gray-800">{item.code}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        {item.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.airline || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.used_count} / {item.max_uses}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs border font-medium ${
                          item.is_active === 1
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-100 text-gray-500 border-gray-200'
                        }`}
                      >
                        {item.is_active === 1 ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {item.expires_at ? new Date(item.expires_at).toLocaleString('zh-CN') : '永久'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(item.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => openEdit(item)}
                          className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-700 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          编辑
                        </button>
                        <button
                          onClick={() => handleToggle(item)}
                          className="text-gray-600 hover:text-blue-700 transition-colors"
                        >
                          {item.is_active === 1 ? '停用' : '启用'}
                        </button>
                        {item.used_count === 0 && (
                          <button
                            onClick={() => setDeleteTarget(item)}
                            className="inline-flex items-center gap-1 text-gray-600 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 text-sm text-gray-600">
            <span>
              共 {total} 条 · 第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => loadList(page - 1, keyword)}
                disabled={page <= 1}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  page <= 1 ? 'border-gray-100 text-gray-300 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                上一页
              </button>
              <button
                onClick={() => loadList(page + 1, keyword)}
                disabled={page >= totalPages}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  page >= totalPages ? 'border-gray-100 text-gray-300 cursor-not-allowed' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">删除邀请码</h3>
            <p className="text-sm text-gray-600 mb-5">
              确定删除邀请码 <span className="font-mono font-medium text-gray-900">{deleteTarget.code}</span>？删除后不可恢复。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                  deleting ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
