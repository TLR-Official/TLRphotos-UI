import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../shared/ThemeContext';
import { useUser } from '../../shared/UserContext';
import { uploadAvatar, changePassword } from '../../api/auth';
import type { User } from '../../api/auth';

export function ProfilePage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { user, isAuthenticated, updateUserInfo } = useUser();
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');
  const [formData, setFormData] = useState<Partial<User>>({});
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth');
      return;
    }
    if (user) {
      setFormData({
        username: user.username,
        bio: user.bio,
        phone: user.phone,
        website: user.website,
        location: user.location,
        custom_fields: user.custom_fields || {},
      });
    }
  }, [isAuthenticated, user, navigate]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleCustomFieldChange = (fieldName: string, value: string, isPrivate: boolean) => {
    setFormData((prev) => ({
      ...prev,
      custom_fields: {
        ...(prev.custom_fields || {}),
        [fieldName]: { value, isPrivate },
      },
    }));
  };

  const addCustomField = () => {
    const newFieldName = `field_${Date.now()}`;
    setFormData((prev) => ({
      ...prev,
      custom_fields: {
        ...(prev.custom_fields || {}),
        [newFieldName]: { value: '', isPrivate: false },
      },
    }));
  };

  const removeCustomField = (fieldName: string) => {
    setFormData((prev) => {
      const newCustomFields = { ...(prev.custom_fields || {}) };
      delete newCustomFields[fieldName];
      return { ...prev, custom_fields: newCustomFields };
    });
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setErrors({ avatar: '只允许上传 JPG、PNG 或 WebP 格式的图片' });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrors({ avatar: '图片大小不能超过 5MB' });
        return;
      }
      setErrors((prev) => ({ ...prev, avatar: '' }));
      const reader = new FileReader();
      reader.onload = (event) => {
        setAvatarPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const validateProfileForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = '请输入有效的邮箱地址';
    }
    if (formData.phone && !/^1[3-9]\d{9}$/.test(formData.phone)) {
      newErrors.phone = '请输入有效的手机号码';
    }
    if (formData.website && !/^https?:\/\/[\w\-.]+(:\d+)?(\/[\w\-./?%&=]*)?$/.test(formData.website)) {
      newErrors.website = '请输入有效的网址';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateProfileForm()) return;

    setIsSubmitting(true);
    setMessage('');

    try {
      if (avatarPreview) {
        const fileInput = document.getElementById('avatar-input') as HTMLInputElement;
        if (fileInput.files?.[0]) {
          const result = await uploadAvatar(fileInput.files[0]);
          if (result.success && result.data) {
            await updateUserInfo({ avatar_url: result.data.avatar_url });
          } else {
            throw new Error(result.message || '上传头像失败');
          }
        }
      }

      const updateData: Partial<User> = {
        username: formData.username,
        bio: formData.bio,
        phone: formData.phone,
        website: formData.website,
        location: formData.location,
        custom_fields: formData.custom_fields,
      };
      await updateUserInfo(updateData);
      setMessage('资料更新成功');
    } catch (error) {
      setMessage((error as Error).message || '更新失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordInputChange = (field: string, value: string) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
    if (passwordErrors[field]) {
      setPasswordErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validatePasswordForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!passwordForm.oldPassword) {
      newErrors.oldPassword = '请输入原密码';
    }
    if (!passwordForm.newPassword) {
      newErrors.newPassword = '请输入新密码';
    } else if (passwordForm.newPassword.length < 6) {
      newErrors.newPassword = '密码长度至少为 6 位';
    }
    if (!passwordForm.confirmPassword) {
      newErrors.confirmPassword = '请确认新密码';
    } else if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      newErrors.confirmPassword = '两次输入的密码不一致';
    }
    setPasswordErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePasswordForm()) return;

    setShowPasswordConfirm(true);
  };

  const confirmPasswordChange = async () => {
    setIsSubmitting(true);
    setMessage('');

    try {
      const result = await changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      if (result.success) {
        setMessage('密码修改成功');
        setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        throw new Error(result.message || '密码修改失败');
      }
    } catch (error) {
      setMessage((error as Error).message || '密码修改失败');
    } finally {
      setShowPasswordConfirm(false);
      setIsSubmitting(false);
    }
  };

  const FieldRow = ({
    label,
    type = 'text',
    placeholder,
    value,
    onChange,
    error,
    isPrivate,
    onTogglePrivate,
  }: {
    label: string;
    type?: string;
    placeholder?: string;
    value?: string | null;
    onChange: (value: string) => void;
    error?: string;
    isPrivate?: boolean;
    onTogglePrivate?: () => void;
  }) => (
    <div className="flex items-center gap-4">
      <label className={`w-24 text-sm font-medium flex-shrink-0 ${
        theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
      }`}>
        {label}
      </label>
      <div className="flex-1 relative">
        <input
          type={type}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full px-4 py-2 rounded-lg border transition-all duration-300 ${
            error
              ? 'border-red-500 bg-red-50'
              : theme === 'dark'
              ? 'bg-white/10 border-white/20 focus:border-purple-500 text-white'
              : 'bg-gray-50 border-gray-200 focus:border-purple-500 text-gray-800'
          } focus:outline-none`}
        />
        {error && (
          <p className="mt-1 text-sm text-red-500">{error}</p>
        )}
      </div>
      {onTogglePrivate && (
        <button
          onClick={onTogglePrivate}
          className={`p-2 rounded-lg transition-colors ${
            isPrivate
              ? theme === 'dark'
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-red-100 text-red-600 hover:bg-red-200'
              : theme === 'dark'
              ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              : 'bg-green-100 text-green-600 hover:bg-green-200'
          }`}
          title={isPrivate ? '设为公开' : '设为私密'}
        >
          {isPrivate ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={`min-h-screen theme-bg-transition ${
      theme === 'dark' ? 'bg-slate-900' : 'bg-gradient-to-br from-gray-50 to-gray-100'
    }`}>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className={`rounded-2xl shadow-xl overflow-hidden ${
          theme === 'dark' ? 'bg-slate-800' : 'bg-white'
        }`}>
          <div className={`p-6 border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-100'}`}>
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className={`w-24 h-24 rounded-full overflow-hidden ${
                  avatarPreview || user?.avatar_url
                    ? ''
                    : 'bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center'
                }`}>
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="头像预览" className="w-full h-full object-cover" />
                  ) : user?.avatar_url ? (
                    <img
                      src={user.avatar_url.startsWith('/') ? `/api${user.avatar_url}` : user.avatar_url}
                      alt={user.username || '用户'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <label className={`absolute bottom-0 right-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity ${
                  theme === 'dark' ? 'text-white' : 'text-white'
                }`}>
                  <input
                    id="avatar-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </label>
              </div>
              <div>
                <h1 className={`text-2xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                  {user?.username || '用户'}
                </h1>
                <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>
                  {user?.email}
                </p>
                {errors.avatar && (
                  <p className="mt-2 text-sm text-red-500">{errors.avatar}</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${
                activeTab === 'profile'
                  ? theme === 'dark'
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-purple-600 border-b-2 border-purple-600'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              个人资料
            </button>
            <button
              onClick={() => setActiveTab('password')}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${
                activeTab === 'password'
                  ? theme === 'dark'
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-purple-600 border-b-2 border-purple-600'
                  : theme === 'dark'
                  ? 'text-slate-400 hover:text-slate-300'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              修改密码
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'profile' ? (
              <form onSubmit={handleProfileSubmit} className="space-y-6">
                <FieldRow
                  label="用户名"
                  placeholder="请输入用户名"
                  value={formData.username}
                  onChange={(v) => handleInputChange('username', v)}
                  error={errors.username}
                />

                <FieldRow
                  label="邮箱"
                  type="email"
                  placeholder="请输入邮箱"
                  value={user?.email}
                  onChange={() => {}}
                />

                <FieldRow
                  label="简介"
                  placeholder="介绍一下自己"
                  value={formData.bio}
                  onChange={(v) => handleInputChange('bio', v)}
                  error={errors.bio}
                />

                <FieldRow
                  label="手机号"
                  type="tel"
                  placeholder="请输入手机号"
                  value={formData.phone}
                  onChange={(v) => handleInputChange('phone', v)}
                  error={errors.phone}
                  isPrivate={false}
                  onTogglePrivate={() => {}}
                />

                <FieldRow
                  label="网站"
                  type="url"
                  placeholder="请输入网址"
                  value={formData.website}
                  onChange={(v) => handleInputChange('website', v)}
                  error={errors.website}
                />

                <FieldRow
                  label="位置"
                  placeholder="请输入所在位置"
                  value={formData.location}
                  onChange={(v) => handleInputChange('location', v)}
                  error={errors.location}
                />

                <div className="pt-4">
                  <h3 className={`text-sm font-medium mb-4 ${theme === 'dark' ? 'text-slate-300' : 'text-gray-700'}`}>
                    自定义资料项
                  </h3>
                  {Object.keys(formData.custom_fields || {}).length > 0 && (
                    <div className="space-y-3">
                      {Object.entries(formData.custom_fields || {}).map(([key, field]) => (
                        <div key={key} className="flex items-center gap-4">
                          <input
                            type="text"
                            value={key.replace(/^field_\d+/, '') || '字段名'}
                            onChange={(e) => {
                              const newKey = e.target.value || key;
                              const newCustomFields = { ...(formData.custom_fields || {}) };
                              delete newCustomFields[key];
                              newCustomFields[newKey] = field;
                              setFormData((prev) => ({ ...prev, custom_fields: newCustomFields }));
                            }}
                            className={`w-24 px-3 py-2 rounded-lg border text-sm transition-all ${
                              theme === 'dark'
                                ? 'bg-white/10 border-white/20 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-800'
                            } focus:outline-none focus:border-purple-500`}
                          />
                          <input
                            type="text"
                            value={field.value}
                            onChange={(e) => handleCustomFieldChange(key, e.target.value, field.isPrivate)}
                            placeholder="字段值"
                            className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all ${
                              theme === 'dark'
                                ? 'bg-white/10 border-white/20 text-white'
                                : 'bg-gray-50 border-gray-200 text-gray-800'
                            } focus:outline-none focus:border-purple-500`}
                          />
                          <button
                            type="button"
                            onClick={() => handleCustomFieldChange(key, field.value, !field.isPrivate)}
                            className={`p-2 rounded-lg transition-colors ${
                              field.isPrivate
                                ? theme === 'dark'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-red-100 text-red-600'
                                : theme === 'dark'
                                ? 'bg-green-500/20 text-green-400'
                                : 'bg-green-100 text-green-600'
                            }`}
                          >
                            {field.isPrivate ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeCustomField(key)}
                            className={`p-2 rounded-lg transition-colors ${
                              theme === 'dark'
                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                : 'bg-red-100 text-red-600 hover:bg-red-200'
                            }`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addCustomField}
                    className={`mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                      theme === 'dark'
                        ? 'bg-white/10 text-slate-300 hover:bg-white/20'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    添加字段
                  </button>
                </div>

                <div className="pt-4 flex gap-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all duration-300 ${
                      isSubmitting
                        ? 'opacity-50 cursor-not-allowed'
                        : theme === 'dark'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                    } shadow-lg`}
                  >
                    {isSubmitting ? '保存中...' : '保存资料'}
                  </button>
                </div>

                {message && (
                  <p className={`text-center text-sm ${
                    message.includes('成功') ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {message}
                  </p>
                )}
              </form>
            ) : (
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="flex items-center gap-4">
                  <label className={`w-24 text-sm font-medium flex-shrink-0 ${
                    theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
                  }`}>
                    原密码
                  </label>
                  <div className="flex-1">
                    <input
                      type="password"
                      value={passwordForm.oldPassword}
                      onChange={(e) => handlePasswordInputChange('oldPassword', e.target.value)}
                      placeholder="请输入原密码"
                      className={`w-full px-4 py-2 rounded-lg border transition-all ${
                        passwordErrors.oldPassword
                          ? 'border-red-500 bg-red-50'
                          : theme === 'dark'
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-gray-50 border-gray-200 text-gray-800'
                      } focus:outline-none focus:border-purple-500`}
                    />
                    {passwordErrors.oldPassword && (
                      <p className="mt-1 text-sm text-red-500">{passwordErrors.oldPassword}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className={`w-24 text-sm font-medium flex-shrink-0 ${
                    theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
                  }`}>
                    新密码
                  </label>
                  <div className="flex-1">
                    <input
                      type="password"
                      value={passwordForm.newPassword}
                      onChange={(e) => handlePasswordInputChange('newPassword', e.target.value)}
                      placeholder="请输入新密码"
                      className={`w-full px-4 py-2 rounded-lg border transition-all ${
                        passwordErrors.newPassword
                          ? 'border-red-500 bg-red-50'
                          : theme === 'dark'
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-gray-50 border-gray-200 text-gray-800'
                      } focus:outline-none focus:border-purple-500`}
                    />
                    {passwordErrors.newPassword && (
                      <p className="mt-1 text-sm text-red-500">{passwordErrors.newPassword}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className={`w-24 text-sm font-medium flex-shrink-0 ${
                    theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
                  }`}>
                    确认密码
                  </label>
                  <div className="flex-1">
                    <input
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) => handlePasswordInputChange('confirmPassword', e.target.value)}
                      placeholder="请再次输入新密码"
                      className={`w-full px-4 py-2 rounded-lg border transition-all ${
                        passwordErrors.confirmPassword
                          ? 'border-red-500 bg-red-50'
                          : theme === 'dark'
                          ? 'bg-white/10 border-white/20 text-white'
                          : 'bg-gray-50 border-gray-200 text-gray-800'
                      } focus:outline-none focus:border-purple-500`}
                    />
                    {passwordErrors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-500">{passwordErrors.confirmPassword}</p>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex gap-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all duration-300 ${
                      isSubmitting
                        ? 'opacity-50 cursor-not-allowed'
                        : theme === 'dark'
                        ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                        : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500'
                    } shadow-lg`}
                  >
                    {isSubmitting ? '修改中...' : '修改密码'}
                  </button>
                </div>

                {message && (
                  <p className={`text-center text-sm ${
                    message.includes('成功') ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {message}
                  </p>
                )}
              </form>
            )}

            {showPasswordConfirm && (
              <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${
                theme === 'dark' ? 'bg-slate-900/80' : 'bg-black/50'
              }`}>
                <div className={`rounded-xl p-6 max-w-md w-full mx-4 ${
                  theme === 'dark' ? 'bg-slate-800' : 'bg-white'
                }`}>
                  <h3 className={`text-lg font-bold mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
                    确认修改密码
                  </h3>
                  <p className={`mb-6 ${theme === 'dark' ? 'text-slate-400' : 'text-gray-600'}`}>
                    确定要修改密码吗？此操作无法撤销。
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setShowPasswordConfirm(false)}
                      className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                        theme === 'dark'
                          ? 'bg-white/10 text-slate-300 hover:bg-white/20'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      取消
                    </button>
                    <button
                      onClick={confirmPasswordChange}
                      disabled={isSubmitting}
                      className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                        isSubmitting
                          ? 'opacity-50 cursor-not-allowed'
                          : theme === 'dark'
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-red-500 text-white hover:bg-red-600'
                      }`}
                    >
                      {isSubmitting ? '修改中...' : '确认修改'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}