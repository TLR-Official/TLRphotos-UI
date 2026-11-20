/**
 * 站点内容管理页（V4.15.0，Q13/Q14）
 * @description
 *  两个 Tab：合作伙伴（关于我们页展示）与规则文件（传图 / 网站规则页展示）。
 *  支持新建、编辑、上线/下线（下线即撤销前端链接）、删除；仅 super / news_editor 可操作。
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Handshake, FileText, RefreshCw } from 'lucide-react';
import {
  getAdminPartners,
  createPartner,
  updatePartner,
  togglePartner,
  deletePartner,
  getAdminRuleFiles,
  createRuleFile,
  updateRuleFile,
  toggleRuleFile,
  deleteRuleFile,
} from './api';
import type { AdminUser, PartnerItem, RuleFileItem } from './types';

type TabKey = 'partners' | 'rules';

/** 合作伙伴表单状态 */
interface PartnerForm {
  name: string;
  description: string;
  logo_url: string;
  logo_text: string;
  sort_order: string;
}

/** 规则文件表单状态 */
interface RuleForm {
  title: string;
  description: string;
  url: string;
  size_text: string;
  version_text: string;
  sort_order: string;
}

const EMPTY_PARTNER_FORM: PartnerForm = { name: '', description: '', logo_url: '', logo_text: '', sort_order: '0' };
const EMPTY_RULE_FORM: RuleForm = { title: '', description: '', url: '', size_text: '', version_text: '', sort_order: '0' };

/** 校验链接：http(s) 或站内绝对路径 */
function isValidLink(value: string): boolean {
  return /^https?:\/\/.+/.test(value) || value.startsWith('/');
}

export function SiteContentPage({ currentAdmin }: { currentAdmin?: AdminUser | null }) {
  const allowed = currentAdmin?.role === 'super' || currentAdmin?.role === 'news_editor';
  const [tab, setTab] = useState<TabKey>('partners');
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [rules, setRules] = useState<RuleFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 合伙人表单
  const [partnerFormOpen, setPartnerFormOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerItem | null>(null);
  const [partnerForm, setPartnerForm] = useState<PartnerForm>(EMPTY_PARTNER_FORM);

  // 规则文件表单
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleFileItem | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>(EMPTY_RULE_FORM);

  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: TabKey; id: string; name: string } | null>(null);

  /** 拉取两个列表 */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const [partnerRes, ruleRes] = await Promise.all([getAdminPartners(), getAdminRuleFiles()]);
    if (partnerRes.success && partnerRes.data) setPartners(partnerRes.data);
    if (ruleRes.success && ruleRes.data) setRules(ruleRes.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) loadAll();
  }, [allowed, loadAll]);

  if (!allowed) {
    return <div className="p-6 text-gray-700">无权限访问：站点内容管理仅对超级管理员与新闻编辑开放。</div>;
  }

  /** 打开新建合作伙伴 */
  const openCreatePartner = () => {
    setEditingPartner(null);
    setPartnerForm(EMPTY_PARTNER_FORM);
    setPartnerFormOpen(true);
    setNotice(null);
  };

  /** 打开编辑合作伙伴 */
  const openEditPartner = (item: PartnerItem) => {
    setEditingPartner(item);
    setPartnerForm({
      name: item.name,
      description: item.description,
      logo_url: item.logo_url || '',
      logo_text: item.logo_text || '',
      sort_order: String(item.sort_order),
    });
    setPartnerFormOpen(true);
    setNotice(null);
  };

  /** 保存合作伙伴 */
  const savePartner = async () => {
    if (saving) return;
    const name = partnerForm.name.trim();
    if (!name) return setNotice({ type: 'error', text: '名称不能为空' });
    if (partnerForm.logo_url.trim() && !isValidLink(partnerForm.logo_url.trim())) {
      return setNotice({ type: 'error', text: 'LOGO 地址须为 http(s) 链接或站内路径' });
    }
    setSaving(true);
    const payload = {
      name,
      description: partnerForm.description.trim(),
      logo_url: partnerForm.logo_url.trim() || null,
      logo_text: partnerForm.logo_text.trim() || null,
      sort_order: Number(partnerForm.sort_order) || 0,
    };
    const res = editingPartner
      ? await updatePartner(editingPartner.id, payload)
      : await createPartner(payload);
    if (res.success) {
      setNotice({ type: 'success', text: editingPartner ? '合作伙伴已更新' : '合作伙伴已创建并上线' });
      setPartnerFormOpen(false);
      await loadAll();
    } else {
      setNotice({ type: 'error', text: res.message || '保存失败' });
    }
    setSaving(false);
  };

  /** 打开新建规则文件 */
  const openCreateRule = () => {
    setEditingRule(null);
    setRuleForm(EMPTY_RULE_FORM);
    setRuleFormOpen(true);
    setNotice(null);
  };

  /** 打开编辑规则文件 */
  const openEditRule = (item: RuleFileItem) => {
    setEditingRule(item);
    setRuleForm({
      title: item.title,
      description: item.description,
      url: item.url,
      size_text: item.size_text || '',
      version_text: item.version_text || '',
      sort_order: String(item.sort_order),
    });
    setRuleFormOpen(true);
    setNotice(null);
  };

  /** 保存规则文件 */
  const saveRule = async () => {
    if (saving) return;
    const title = ruleForm.title.trim();
    const url = ruleForm.url.trim();
    if (!title) return setNotice({ type: 'error', text: '标题不能为空' });
    if (!url || !isValidLink(url)) {
      return setNotice({ type: 'error', text: '文件链接必填，且须为 http(s) 链接或站内路径' });
    }
    setSaving(true);
    const payload = {
      title,
      description: ruleForm.description.trim(),
      url,
      size_text: ruleForm.size_text.trim() || null,
      version_text: ruleForm.version_text.trim() || null,
      sort_order: Number(ruleForm.sort_order) || 0,
    };
    const res = editingRule
      ? await updateRuleFile(editingRule.id, payload)
      : await createRuleFile(payload);
    if (res.success) {
      setNotice({ type: 'success', text: editingRule ? '规则文件已更新' : '规则文件已创建并上线' });
      setRuleFormOpen(false);
      await loadAll();
    } else {
      setNotice({ type: 'error', text: res.message || '保存失败' });
    }
    setSaving(false);
  };

  /** 上下线切换 */
  const handleToggle = async (type: TabKey, id: string) => {
    const res = type === 'partners' ? await togglePartner(id) : await toggleRuleFile(id);
    if (res.success) {
      setNotice({ type: 'success', text: res.data?.is_active ? '已上线' : '已下线' });
      await loadAll();
    } else {
      setNotice({ type: 'error', text: res.message || '操作失败' });
    }
  };

  /** 删除（二次确认） */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = deleteTarget.type === 'partners' ? await deletePartner(deleteTarget.id) : await deleteRuleFile(deleteTarget.id);
    if (res.success) {
      setNotice({ type: 'success', text: '已删除' });
      setDeleteTarget(null);
      await loadAll();
    } else {
      setNotice({ type: 'error', text: res.message || '删除失败' });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-black">站点内容</h1>
          <p className="mt-1 text-sm text-gray-500">维护「关于我们」合作伙伴与「传图 / 网站规则」文件链接。</p>
        </div>
        <button
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:border-blue-300 hover:text-blue-700"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {notice && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            notice.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b border-gray-200 mb-4">
        <button
          onClick={() => setTab('partners')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'partners' ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Handshake className="w-4 h-4" /> 合作伙伴
        </button>
        <button
          onClick={() => setTab('rules')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'rules' ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText className="w-4 h-4" /> 规则文件
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-gray-500">加载中…</p>
      ) : tab === 'partners' ? (
        <div>
          <button
            onClick={openCreatePartner}
            className="mb-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-700 rounded-lg hover:bg-blue-800"
          >
            <Plus className="w-4 h-4" /> 新建合作伙伴
          </button>
          <div className="space-y-3">
            {partners.length === 0 && <p className="text-sm text-gray-500">暂无合作伙伴。</p>}
            {partners.map((item) => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{item.name}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {item.is_active ? '上线中' : '已下线'}
                    </span>
                    <span className="text-xs text-gray-400">排序 {item.sort_order}</span>
                  </div>
                  {item.description && <p className="mt-1 text-sm text-gray-600">{item.description}</p>}
                  {(item.logo_url || item.logo_text) && (
                    <p className="mt-1 text-xs text-gray-400">LOGO：{item.logo_url || item.logo_text}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openEditPartner(item)} className="p-2 text-gray-500 hover:text-blue-700" aria-label="编辑">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => void handleToggle('partners', item.id)} className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:border-blue-300">
                    {item.is_active ? '下线' : '上线'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ type: 'partners', id: item.id, name: item.name })}
                    className="p-2 text-gray-400 hover:text-red-600"
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={openCreateRule}
            className="mb-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-700 rounded-lg hover:bg-blue-800"
          >
            <Plus className="w-4 h-4" /> 新建规则文件
          </button>
          <div className="space-y-3">
            {rules.length === 0 && <p className="text-sm text-gray-500">暂无规则文件。</p>}
            {rules.map((item) => (
              <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{item.title}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${item.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {item.is_active ? '上线中' : '已下线'}
                    </span>
                    <span className="text-xs text-gray-400">排序 {item.sort_order}</span>
                  </div>
                  {item.description && <p className="mt-1 text-sm text-gray-600">{item.description}</p>}
                  <p className="mt-1 text-xs text-blue-700 break-all">{item.url}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {[item.version_text, item.size_text].filter(Boolean).join(' · ') || '未填写版本/体积'}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openEditRule(item)} className="p-2 text-gray-500 hover:text-blue-700" aria-label="编辑">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => void handleToggle('rules', item.id)} className="px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:border-blue-300">
                    {item.is_active ? '撤销链接' : '重新上线'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ type: 'rules', id: item.id, name: item.title })}
                    className="p-2 text-gray-400 hover:text-red-600"
                    aria-label="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 合作伙伴表单弹窗 */}
      {partnerFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900">{editingPartner ? '编辑合作伙伴' : '新建合作伙伴'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-gray-600">名称 *</span>
                <input value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={100} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">简介</span>
                <textarea value={partnerForm.description} onChange={(e) => setPartnerForm({ ...partnerForm, description: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={3} maxLength={1000} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">LOGO 图片地址（可选，http(s) 或站内路径）</span>
                <input value={partnerForm.logo_url} onChange={(e) => setPartnerForm({ ...partnerForm, logo_url: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={500} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">LOGO 文字（无图片时展示，最多 16 字）</span>
                <input value={partnerForm.logo_text} onChange={(e) => setPartnerForm({ ...partnerForm, logo_text: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={16} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">排序（越小越靠前）</span>
                <input type="number" value={partnerForm.sort_order} onChange={(e) => setPartnerForm({ ...partnerForm, sort_order: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPartnerFormOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
              <button onClick={() => void savePartner()} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-700 rounded-lg disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 规则文件表单弹窗 */}
      {ruleFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900">{editingRule ? '编辑规则文件' : '新建规则文件'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-gray-600">标题 *</span>
                <input value={ruleForm.title} onChange={(e) => setRuleForm({ ...ruleForm, title: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={100} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">说明</span>
                <textarea value={ruleForm.description} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" rows={2} maxLength={1000} />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">文件链接 *（http(s) 或站内路径，如 /rule-files/xxx.pdf）</span>
                <input value={ruleForm.url} onChange={(e) => setRuleForm({ ...ruleForm, url: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={500} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-gray-600">体积文案</span>
                  <input value={ruleForm.size_text} onChange={(e) => setRuleForm({ ...ruleForm, size_text: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={50} placeholder="约 466 KB" />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600">版本文案</span>
                  <input value={ruleForm.version_text} onChange={(e) => setRuleForm({ ...ruleForm, version_text: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" maxLength={50} placeholder="2026-11 版" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-gray-600">排序（越小越靠前）</span>
                <input type="number" value={ruleForm.sort_order} onChange={(e) => setRuleForm({ ...ruleForm, sort_order: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRuleFormOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
              <button onClick={() => void saveRule()} disabled={saving} className="px-4 py-2 text-sm text-white bg-blue-700 rounded-lg disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除二次确认 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900">确认删除</h2>
            <p className="mt-2 text-sm text-gray-600">确定删除「{deleteTarget.name}」？删除后不可恢复；如仅需下线，请使用上下线按钮。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">取消</button>
              <button onClick={() => void handleDelete()} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
