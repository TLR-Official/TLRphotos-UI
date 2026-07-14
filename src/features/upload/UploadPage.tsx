import { useState } from 'react';
import { PhotoUploader } from '../../shared/PhotoUploader';
import { useTheme } from '../../shared/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../shared/UserContext';

interface UploadPhotoInfo {
  photoId: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
}

export function UploadPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { isAuthenticated } = useUser();
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadPhotoInfo[]>([]);
  const [activeTab, setActiveTab] = useState<'upload' | 'edit'>('upload');
  const [errors, setErrors] = useState<string[]>([]);

  const handleUploadSuccess = (photoId: string, url: string) => {
    setUploadedPhotos((prev) => [...prev, {
      photoId,
      url,
      title: '',
      description: '',
      tags: [],
    }]);
    setErrors([]);
  };

  const handleUploadError = (error: string) => {
    setErrors((prev) => [...prev, error]);
  };

  const handleUpdatePhotoInfo = (index: number, field: 'title' | 'description' | 'tags', value: string | string[]) => {
    setUploadedPhotos((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemovePhoto = (index: number) => {
    setUploadedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveAll = () => {
    const validPhotos = uploadedPhotos.filter((p) => p.title.trim());
    if (validPhotos.length === 0) {
      setErrors(['请至少填写一张照片的标题']);
      return;
    }
    navigate('/gallery');
  };

  const handleTagInput = (index: number, input: string) => {
    const tags = input.split(',').map((t) => t.trim()).filter((t) => t);
    handleUpdatePhotoInfo(index, 'tags', tags);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className={`p-8 rounded-2xl ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'} shadow-xl`}>
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">请先登录</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">上传图片需要登录账户</p>
          <button
            onClick={() => navigate('/auth')}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-bold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
            上传图片
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            分享您的精彩航空摄影作品
          </p>
        </div>

        <div className="flex justify-center mb-6">
          <div className={`inline-flex rounded-xl p-1 ${theme === 'dark' ? 'bg-slate-800' : 'bg-gray-100'}`}>
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-6 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'upload'
                  ? 'bg-blue-500 text-white shadow-md'
                  : theme === 'dark'
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              上传图片
            </button>
            <button
              onClick={() => setActiveTab('edit')}
              disabled={uploadedPhotos.length === 0}
              className={`px-6 py-2 rounded-lg transition-all duration-300 ${
                activeTab === 'edit'
                  ? 'bg-blue-500 text-white shadow-md'
                  : uploadedPhotos.length === 0
                    ? 'text-gray-400 cursor-not-allowed'
                    : theme === 'dark'
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              编辑信息 ({uploadedPhotos.length})
            </button>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="mb-6 space-y-2">
            {errors.map((error, index) => (
              <div key={index} className="px-4 py-3 bg-red-100 text-red-600 rounded-lg text-sm">
                {error}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'upload' && (
          <div className={`p-6 rounded-2xl ${theme === 'dark' ? 'bg-slate-800/95' : 'bg-white'} shadow-xl`}>
            <PhotoUploader
              onSuccess={handleUploadSuccess}
              onError={handleUploadError}
            />
          </div>
        )}

        {activeTab === 'edit' && uploadedPhotos.length > 0 && (
          <div className="space-y-6">
            {uploadedPhotos.map((photo, index) => (
              <div
                key={photo.photoId}
                className={`p-6 rounded-2xl ${theme === 'dark' ? 'bg-slate-800/95' : 'bg-white'} shadow-xl`}
              >
                <div className="flex gap-6">
                  <div className="w-48 h-32 rounded-lg overflow-hidden flex-shrink-0">
                    <img
                      src={photo.url}
                      alt={photo.title || `照片 ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className={`block text-sm font-medium mb-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                        标题 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={photo.title}
                        onChange={(e) => handleUpdatePhotoInfo(index, 'title', e.target.value)}
                        placeholder="请输入照片标题"
                        className={`w-full px-4 py-2 rounded-lg border ${
                          theme === 'dark'
                            ? 'border-gray-600 bg-slate-700 text-white'
                            : 'border-gray-300 bg-white text-gray-800'
                        } focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                        描述
                      </label>
                      <textarea
                        value={photo.description}
                        onChange={(e) => handleUpdatePhotoInfo(index, 'description', e.target.value)}
                        placeholder="请输入照片描述（可选）"
                        rows={3}
                        className={`w-full px-4 py-2 rounded-lg border resize-none ${
                          theme === 'dark'
                            ? 'border-gray-600 bg-slate-700 text-white'
                            : 'border-gray-300 bg-white text-gray-800'
                        } focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>

                    <div>
                      <label className={`block text-sm font-medium mb-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                        标签
                      </label>
                      <input
                        type="text"
                        value={photo.tags.join(', ')}
                        onChange={(e) => handleTagInput(index, e.target.value)}
                        placeholder="多个标签用逗号分隔"
                        className={`w-full px-4 py-2 rounded-lg border ${
                          theme === 'dark'
                            ? 'border-gray-600 bg-slate-700 text-white'
                            : 'border-gray-300 bg-white text-gray-800'
                        } focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500`}
                      />
                      {photo.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {photo.tags.map((tag, tagIndex) => (
                            <span
                              key={tagIndex}
                              className={`px-2 py-1 rounded-full text-xs ${
                                theme === 'dark'
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-blue-100 text-blue-600'
                              }`}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleRemovePhoto(index)}
                        className="px-4 py-2 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex justify-center gap-4">
              <button
                onClick={() => setActiveTab('upload')}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                继续上传
              </button>
              <button
                onClick={handleSaveAll}
                className="px-8 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
              >
                保存并发布
              </button>
            </div>
          </div>
        )}

        {activeTab === 'edit' && uploadedPhotos.length === 0 && (
          <div className={`p-12 rounded-2xl ${theme === 'dark' ? 'bg-slate-800/95' : 'bg-white'} shadow-xl text-center`}>
            <div className={`w-20 h-20 mx-auto mb-4 rounded-full ${theme === 'dark' ? 'bg-slate-700' : 'bg-gray-100'} flex items-center justify-center`}>
              <svg className="w-10 h-10 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </div>
            <h3 className={`text-lg font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
              暂无上传的图片
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              请先上传图片，然后再编辑照片信息
            </p>
            <button
              onClick={() => setActiveTab('upload')}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              去上传
            </button>
          </div>
        )}
      </div>
    </div>
  );
}