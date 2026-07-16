import { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Search, Shield, Eye, EyeOff } from 'lucide-react';
import { getAdminUsers, createAdmin, updateAdmin, deleteAdmin } from './api';
import type { AdminUser } from './types';

export function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    name: '',
    role: 'zone_auditor' as 'super' | 'zone_master' | 'zone_auditor',
    zone: 'default',
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const fetchAdmins = async () => {
      const result = await getAdminUsers();
      if (result.success && result.data) {
        setAdmins(result.data);
      }
      setLoading(false);
    };
    fetchAdmins();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAdmin) {
      const result = await updateAdmin(editingAdmin.id, formData);
      if (result.success) {
        setAdmins(admins.map(a => a.id === editingAdmin.id ? { ...a, ...formData } : a));
      }
    } else {
      const result = await createAdmin(formData);
      if (result.success) {
        setAdmins([...admins, result.data!]);
      }
    }
    setShowModal(false);
    setEditingAdmin(null);
    setFormData({ username: '', password: '', email: '', name: '', role: 'zone_auditor', zone: 'default' });
  };

  const handleDelete = async (adminId: string) => {
    if (confirm('确定要删除这个管理员吗？')) {
      const result = await deleteAdmin(adminId);
      if (result.success) {
        setAdmins(admins.filter(a => a.id !== adminId));
      }
    }
  };

  const handleEdit = (admin: AdminUser) => {
    setEditingAdmin(admin);
    setFormData({
      username: admin.username,
      password: '',
      email: admin.email || '',
      name: admin.name || '',
      role: admin.role,
      zone: admin.zone,
    });
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingAdmin(null);
    setFormData({ username: '', password: '', email: '', name: '', role: 'zone_auditor', zone: 'default' });
    setShowModal(true);
  };

  const filteredAdmins = admins.filter(admin =>
    admin.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (admin.name && admin.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (admin.email && admin.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const roleLabel = {
    super: '最高账户',
    zone_master: '分区总审核',
    zone_auditor: '分区审核',
  };

  const roleColor = {
    super: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    zone_master: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    zone_auditor: 'bg-green-500/10 text-green-400 border-green-500/30',
  };

  const statusLabel = {
    1: '启用',
    0: '禁用',
  };

  const statusColor = {
    1: 'bg-green-500/10 text-green-400',
    0: 'bg-red-500/10 text-red-400',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">管理员管理</h2>
          <p className="text-slate-400 mt-1">管理系统管理员账户</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all"
        >
          <Plus className="w-5 h-5" />
          添加管理员
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="搜索用户名、姓名或邮箱..."
        />
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">管理员信息</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">角色</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">分区</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">状态</th>
              <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredAdmins.map(admin => (
              <tr key={admin.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                <td className="py-4 px-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-semibold">
                      {admin.name?.charAt(0).toUpperCase() || admin.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-medium">{admin.name || admin.username}</p>
                      <p className="text-slate-400 text-sm">{admin.username}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${roleColor[admin.role as keyof typeof roleColor]}`}>
                    <Shield className="w-3 h-3" />
                    {roleLabel[admin.role as keyof typeof roleLabel]}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <span className="text-slate-300 text-sm">{admin.zone}</span>
                </td>
                <td className="py-4 px-6">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${statusColor[admin.is_active as keyof typeof statusColor]}`}>
                    <div className={`w-2 h-2 rounded-full ${admin.is_active ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    {statusLabel[admin.is_active as keyof typeof statusLabel]}
                  </span>
                </td>
                <td className="py-4 px-6">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(admin)}
                      className="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-all"
                      title="编辑"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {admin.role !== 'super' && (
                      <button
                        onClick={() => handleDelete(admin.id)}
                        className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredAdmins.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">暂无管理员</p>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md p-6">
            <h3 className="text-xl font-semibold text-white mb-6">
              {editingAdmin ? '编辑管理员' : '添加管理员'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">用户名</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  {editingAdmin ? '新密码（留空不修改）' : '密码'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-2.5 pr-12 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="输入密码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">姓名</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">邮箱</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入邮箱"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">角色</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'super' | 'zone_master' | 'zone_auditor' })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="zone_auditor">分区审核</option>
                  <option value="zone_master">分区总审核</option>
                  <option value="super">最高账户</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">分区</label>
                <input
                  type="text"
                  value={formData.zone}
                  onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  defaultValue="default"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingAdmin(null); }}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all"
                >
                  {editingAdmin ? '保存' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}