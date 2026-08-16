/**
 * 管理员管理页
 * 列表展示所有管理员账户，支持创建新管理员（zone_master / zone_auditor）、
 * 编辑非 super 账户的角色与分区、删除非 super 账户。super 账户不可编辑或删除。
 * - super：可创建 zone_auditor / zone_master，可选任意分区，可编辑/删除所有非 super 账户
 * - zone_master：仅可创建本分区的 zone_auditor，分区不可改，不可编辑/删除任何账户
 */
import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, User } from 'lucide-react';
import { getAdminUsers, createAdmin, updateAdmin, deleteAdmin, getZones } from './api';
import type { Zone } from './api';
import type { AdminUser } from './types';

interface AdminsPageProps {
  /** 当前登录管理员，用于按角色控制创建/编辑/删除权限与分区过滤 */
  currentAdmin: AdminUser;
}

/**
 * 管理员管理页组件
 * @returns 加载态 / 管理员表格 + 创建/编辑弹窗 JSX
 */
export function AdminsPage({ currentAdmin }: AdminsPageProps) {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  // 当前编辑中的管理员（用于编辑弹窗回显与提交时取 id）
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  // 表单数据：创建与编辑共用一份状态，编辑时回填已有字段
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    name: '',
    role: 'zone_auditor' as 'zone_master' | 'zone_auditor',
    zone: 'default',
  });
  const [error, setError] = useState('');

  // 角色权限标志：super 拥有完整权限；zone_master 仅可创建本分区审核员
  const isSuper = currentAdmin.role === 'super';
  const isZoneMaster = currentAdmin.role === 'zone_master';
  // 创建表单中可选的角色选项：super 可选两种，zone_master 仅可选分区审核
  const roleOptions: { value: 'zone_master' | 'zone_auditor'; label: string }[] = isSuper
    ? [
        { value: 'zone_auditor', label: '分区审核' },
        { value: 'zone_master', label: '分区总审核' },
      ]
    : [{ value: 'zone_auditor', label: '分区审核' }];
  // zone_master 创建时分区锁定为本分区，不可修改
  const zoneLocked = isZoneMaster;

  // 首次挂载拉取管理员列表与分区列表
  useEffect(() => {
    fetchAdmins();
    fetchZones();
  }, []);

  /** 拉取管理员列表：zone_master 仅拉取本分区，super 拉取全部 */
  const fetchAdmins = async () => {
    setLoading(true);
    const zoneFilter = isZoneMaster ? currentAdmin.zone : undefined;
    const result = await getAdminUsers(undefined, zoneFilter);
    if (result.success && result.data) {
      setAdmins(result.data);
    }
    setLoading(false);
  };

  /** 拉取分区列表（用于下拉选择与表格分区名展示） */
  const fetchZones = async () => {
    const result = await getZones();
    if (result.success && result.data) {
      setZones(result.data);
    }
  };

  /** 根据分区 id 查询分区名（找不到时回退为原始 id） */
  const getZoneName = (zoneId: string) => {
    const z = zones.find(item => item.id === zoneId);
    return z ? z.name : zoneId;
  };

  /**
   * 创建管理员
   * 校验用户名与密码必填，成功后刷新列表、关闭弹窗并重置表单。
   */
  const handleCreate = async () => {
    setError('');
    if (!formData.username || !formData.password) {
      setError('请填写用户名和密码');
      return;
    }
    const result = await createAdmin(formData);
    if (result.success) {
      fetchAdmins();
      setShowCreateModal(false);
      resetCreateForm();
    } else {
      setError(result.message || '创建失败');
    }
  };

  /** 重置创建表单为初始默认值（zone_master 锁定本分区） */
  const resetCreateForm = () => {
    setFormData({
      username: '',
      password: '',
      email: '',
      name: '',
      role: 'zone_auditor',
      zone: isZoneMaster ? currentAdmin.zone : (zones[0]?.id || 'default'),
    });
  };

  /**
   * 打开创建弹窗
   * 初始化表单：zone_master 默认角色为分区审核、分区锁定为本分区；
   * super 默认角色为分区审核、分区为列表首项。
   */
  const openCreateModal = () => {
    setError('');
    resetCreateForm();
    setShowCreateModal(true);
  };

  /**
   * 编辑管理员
   * 仅提交可修改字段（邮箱、姓名、角色、分区），用户名不可改、密码不在编辑流程中提交。
   */
  const handleEdit = async () => {
    if (!editingAdmin) return;
    setError('');
    const result = await updateAdmin(editingAdmin.id, {
      email: formData.email || undefined,
      name: formData.name || undefined,
      role: formData.role,
      zone: formData.zone,
    });
    if (result.success) {
      fetchAdmins();
      setShowEditModal(false);
      setEditingAdmin(null);
    } else {
      setError(result.message || '更新失败');
    }
  };

  /**
   * 删除管理员（带二次确认）
   * @param id 待删除管理员 id
   */
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该管理员吗？')) return;
    const result = await deleteAdmin(id);
    if (result.success) {
      fetchAdmins();
    }
  };

  /**
   * 打开编辑弹窗
   * 将选中管理员字段回填到表单，密码留空（编辑不修改密码）。
   * @param admin 待编辑的管理员
   */
  const openEditModal = (admin: AdminUser) => {
    setEditingAdmin(admin);
    setFormData({
      username: admin.username,
      password: '',
      email: admin.email || '',
      name: admin.name || '',
      role: admin.role as 'zone_master' | 'zone_auditor',
      zone: admin.zone,
    });
    setShowEditModal(true);
  };

  /** 角色标识到中文标签的映射，用于表格中显示角色徽章 */
  const roleLabel = {
    super: '最高账户',
    zone_master: '分区总审核',
    zone_auditor: '分区审核',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">管理员管理</h2>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          创建管理员
        </button>
      </div>

      {loading ? (
        <div className="text-gray-800 text-center py-10">加载中...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">用户名</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">姓名</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">邮箱</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">角色</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">分区</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map(admin => (
                <tr key={admin.id} className="border-t border-gray-200">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="text-gray-800">{admin.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{admin.name || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{admin.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-sm ${
                      admin.role === 'super' ? 'bg-purple-50 text-purple-600' :
                      admin.role === 'zone_master' ? 'bg-blue-50 text-blue-600' :
                      'bg-green-50 text-green-600'
                    }`}>
                      {roleLabel[admin.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{getZoneName(admin.zone)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {isSuper && admin.role !== 'super' && (
                        <>
                          <button
                            onClick={() => openEditModal(admin)}
                            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(admin.id)}
                            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-100 rounded transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {admins.length === 0 && (
            <div className="text-center py-10 text-gray-500">暂无管理员</div>
          )}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-gray-800 font-medium">创建管理员</h3>
            </div>
            <div className="p-4 space-y-4">
              {error && <div className="text-red-600 text-sm">{error}</div>}
              <div>
                <label className="block text-gray-600 text-sm mb-1">用户名 *</label>
                <input type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">密码 *</label>
                <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">姓名</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">邮箱</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as 'zone_master' | 'zone_auditor'})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800">
                  {roleOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">分区{zoneLocked ? ' (本分区，不可修改)' : ''}</label>
                <select value={formData.zone} disabled={zoneLocked} onChange={e => setFormData({...formData, zone: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800 disabled:bg-gray-50 disabled:text-gray-400">
                  {zones.length === 0 ? (
                    <option value={formData.zone}>{formData.zone}</option>
                  ) : (
                    zones.map(zone => (
                      <option key={zone.id} value={zone.id}>{zone.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowCreateModal(false); resetCreateForm(); }} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg">取消</button>
                <button onClick={handleCreate} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">创建</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-gray-800 font-medium">编辑管理员</h3>
            </div>
            <div className="p-4 space-y-4">
              {error && <div className="text-red-600 text-sm">{error}</div>}
              <div>
                <label className="block text-gray-600 text-sm mb-1">用户名 (不可修改)</label>
                <input type="text" value={formData.username} disabled className="w-full p-2 bg-gray-50 border border-gray-300 rounded text-gray-400" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">姓名</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">邮箱</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800" />
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as 'zone_master' | 'zone_auditor'})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800">
                  {roleOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-600 text-sm mb-1">分区</label>
                <select value={formData.zone} onChange={e => setFormData({...formData, zone: e.target.value})} className="w-full p-2 bg-white border border-gray-300 rounded text-gray-800">
                  {zones.length === 0 ? (
                    <option value={formData.zone}>{formData.zone}</option>
                  ) : (
                    zones.map(zone => (
                      <option key={zone.id} value={zone.id}>{zone.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowEditModal(false); setEditingAdmin(null); }} className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg">取消</button>
                <button onClick={handleEdit} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}