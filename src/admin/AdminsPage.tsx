import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, User } from 'lucide-react';
import { getAdminUsers, createAdmin, updateAdmin, deleteAdmin } from './api';
import type { AdminUser } from './types';

export function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    name: '',
    role: 'zone_auditor' as 'zone_master' | 'zone_auditor',
    zone: 'default',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    setLoading(true);
    const result = await getAdminUsers();
    if (result.success && result.data) {
      setAdmins(result.data);
    }
    setLoading(false);
  };

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
      setFormData({ username: '', password: '', email: '', name: '', role: 'zone_auditor', zone: 'default' });
    } else {
      setError(result.message || '创建失败');
    }
  };

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

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该管理员吗？')) return;
    const result = await deleteAdmin(id);
    if (result.success) {
      fetchAdmins();
    }
  };

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

  const roleLabel = {
    super: '最高账户',
    zone_master: '分区总审核',
    zone_auditor: '分区审核',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">管理员管理</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          创建管理员
        </button>
      </div>

      {loading ? (
        <div className="text-white text-center py-10">加载中...</div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-700">
              <tr>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">用户名</th>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">姓名</th>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">邮箱</th>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">角色</th>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">分区</th>
                <th className="text-left px-4 py-3 text-slate-300 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map(admin => (
                <tr key={admin.id} className="border-t border-slate-700">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm">
                        <User className="w-4 h-4" />
                      </div>
                      <span className="text-white">{admin.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{admin.name || '-'}</td>
                  <td className="px-4 py-3 text-slate-300">{admin.email || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-sm ${
                      admin.role === 'super' ? 'bg-purple-500/20 text-purple-400' :
                      admin.role === 'zone_master' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>
                      {roleLabel[admin.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{admin.zone}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {admin.role !== 'super' && (
                        <>
                          <button
                            onClick={() => openEditModal(admin)}
                            className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(admin.id)}
                            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
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
            <div className="text-center py-10 text-slate-400">暂无管理员</div>
          )}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-white font-medium">创建管理员</h3>
            </div>
            <div className="p-4 space-y-4">
              {error && <div className="text-red-400 text-sm">{error}</div>}
              <div>
                <label className="block text-slate-300 text-sm mb-1">用户名 *</label>
                <input type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">密码 *</label>
                <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">姓名</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">邮箱</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as 'zone_master' | 'zone_auditor'})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white">
                  <option value="zone_auditor">分区审核</option>
                  <option value="zone_master">分区总审核</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">分区</label>
                <input type="text" value={formData.zone} onChange={e => setFormData({...formData, zone: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowCreateModal(false); setFormData({ username: '', password: '', email: '', name: '', role: 'zone_auditor', zone: 'default' }); }} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg">取消</button>
                <button onClick={handleCreate} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">创建</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-white font-medium">编辑管理员</h3>
            </div>
            <div className="p-4 space-y-4">
              {error && <div className="text-red-400 text-sm">{error}</div>}
              <div>
                <label className="block text-slate-300 text-sm mb-1">用户名 (不可修改)</label>
                <input type="text" value={formData.username} disabled className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-slate-500" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">姓名</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">邮箱</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">角色</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as 'zone_master' | 'zone_auditor'})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white">
                  <option value="zone_auditor">分区审核</option>
                  <option value="zone_master">分区总审核</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm mb-1">分区</label>
                <input type="text" value={formData.zone} onChange={e => setFormData({...formData, zone: e.target.value})} className="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white" />
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowEditModal(false); setEditingAdmin(null); }} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg">取消</button>
                <button onClick={handleEdit} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}