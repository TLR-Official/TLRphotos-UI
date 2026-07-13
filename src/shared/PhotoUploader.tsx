import { useState, useCallback, useRef } from 'react';
import { getPresignedUrl, completeUpload } from '../api/photos';
import { useTheme } from './ThemeContext';

interface UploadFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message: string;
}

interface PhotoUploaderProps {
  onSuccess?: (photoId: string, url: string) => void;
  onError?: (error: string) => void;
}

export function PhotoUploader({ onSuccess, onError }: PhotoUploaderProps) {
  const { theme } = useTheme();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  const generateId = () => `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const validateFile = (file: File): { valid: boolean; message?: string } => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!validTypes.includes(file.type)) {
      return { valid: false, message: `文件 ${file.name} 格式不支持，仅支持 JPG、PNG、WebP、HEIC` };
    }
    if (file.size > 50 * 1024 * 1024) {
      return { valid: false, message: `文件 ${file.name} 大小超过 50MB 限制` };
    }
    return { valid: true };
  };

  const handleFileSelect = useCallback((selectedFiles: File[]) => {
    const newFiles: UploadFile[] = [];
    let errorMessage = '';

    selectedFiles.forEach((file) => {
      const validation = validateFile(file);
      if (validation.valid) {
        newFiles.push({
          id: generateId(),
          file,
          preview: URL.createObjectURL(file),
          progress: 0,
          status: 'pending',
          message: '',
        });
      } else if (validation.message) {
        errorMessage = validation.message;
      }
    });

    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
    }
    if (errorMessage) {
      onError?.(errorMessage);
    }
  }, [onError]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      handleFileSelect(Array.from(selectedFiles));
    }
    e.target.value = '';
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFileSelect(Array.from(droppedFiles));
    }
  }, [handleFileSelect]);

  const handleUploadFile = useCallback(async (uploadFile: UploadFile) => {
    const { id, file } = uploadFile;

    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'uploading', progress: 0, message: '正在获取上传地址...' } : f))
    );

    try {
      const presignedResult = await getPresignedUrl(file.name);
      if (!presignedResult.success || !presignedResult.data) {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', progress: 0, message: presignedResult.message || '获取上传地址失败' } : f))
        );
        onError?.(presignedResult.message || '获取上传地址失败');
        return;
      }

      const { uploadUrl, key } = presignedResult.data;
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, progress: 10, message: '正在上传图片...' } : f))
      );

      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`上传失败: ${response.status}`);
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, progress: 80, message: '正在保存照片信息...' } : f))
      );

      const completeResult = await completeUpload(key, {
        title: file.name.replace(/\.[^/.]+$/, ''),
      });

      if (!completeResult.success || !completeResult.data) {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', progress: 0, message: completeResult.message || '保存照片信息失败' } : f))
        );
        onError?.(completeResult.message || '保存照片信息失败');
        return;
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'success', progress: 100, message: '上传成功' } : f))
      );
      onSuccess?.(completeResult.data.photoId, completeResult.data.url);

    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', progress: 0, message: '上传已取消' } : f))
        );
      } else {
        const errorMsg = error instanceof Error ? error.message : '上传失败';
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, status: 'error', progress: 0, message: errorMsg } : f))
        );
        onError?.(errorMsg);
      }
    } finally {
      abortControllers.current.delete(id);
    }
  }, [onSuccess, onError]);

  const handleCancelUpload = useCallback((id: string) => {
    abortControllers.current.get(id)?.abort();
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    abortControllers.current.get(id)?.abort();
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const handleUploadAll = useCallback(() => {
    files.forEach((file) => {
      if (file.status === 'pending') {
        handleUploadFile(file);
      }
    });
  }, [files, handleUploadFile]);

  const handleClearAll = useCallback(() => {
    files.forEach((file) => {
      abortControllers.current.get(file.id)?.abort();
      URL.revokeObjectURL(file.preview);
    });
    setFiles([]);
  }, [files]);

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const uploadingCount = files.filter((f) => f.status === 'uploading').length;
  const successCount = files.filter((f) => f.status === 'success').length;

  return (
    <div className="w-full">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        onChange={handleFileChange}
        className="hidden"
        id="photo-upload-input"
        multiple
      />

      <div
        className={`
          border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300
          ${isDragging
            ? 'border-blue-500 bg-blue-50 scale-[1.02]'
            : files.length > 0
              ? 'border-blue-300 bg-blue-50/50'
              : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-blue-400'
          }
        `}
        onClick={() => document.getElementById('photo-upload-input')?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="space-y-4">
          <div className={`w-24 h-24 mx-auto rounded-lg overflow-hidden ${isDragging ? 'bg-blue-200' : 'bg-gray-200 dark:bg-gray-700'}`}>
            <svg className={`w-full h-full ${isDragging ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <p className={`font-medium ${isDragging ? 'text-blue-600' : 'text-gray-600 dark:text-gray-300'}`}>
            {isDragging ? '释放鼠标上传图片' : '点击或拖拽上传图片'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            支持 JPG、PNG、WebP、HEIC，最大 50MB，可多选
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200">
              待上传图片 ({files.length})
              {successCount > 0 && (
                <span className="ml-2 text-sm text-green-500">已完成 {successCount}</span>
              )}
              {uploadingCount > 0 && (
                <span className="ml-2 text-sm text-blue-500">上传中 {uploadingCount}</span>
              )}
            </h3>
            <div className="flex gap-2">
              {pendingCount > 0 && (
                <button
                  onClick={handleUploadAll}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
                >
                  全部上传
                </button>
              )}
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
              >
                清空列表
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((uploadFile) => (
              <div
                key={uploadFile.id}
                className={`
                  rounded-xl overflow-hidden shadow-lg transition-all duration-300
                  ${theme === 'dark' ? 'bg-slate-800/95 border border-white/10' : 'bg-white border border-gray-200'}
                `}
              >
                <div className="relative aspect-video">
                  <img
                    src={uploadFile.preview}
                    alt={uploadFile.file.name}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleRemoveFile(uploadFile.id)}
                    className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors flex items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>

                  {uploadFile.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                        <div className="text-white text-sm">{uploadFile.progress}%</div>
                      </div>
                    </div>
                  )}

                  {uploadFile.status === 'success' && (
                    <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-8 h-8">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    </div>
                  )}

                  {uploadFile.status === 'error' && (
                    <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center">
                      <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-8 h-8">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="15" y1="9" x2="9" y2="15"></line>
                          <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <p className="text-sm font-medium truncate text-gray-700 dark:text-gray-200">
                    {uploadFile.file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(uploadFile.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>

                  {uploadFile.status === 'pending' && (
                    <button
                      onClick={() => handleUploadFile(uploadFile)}
                      className="mt-2 w-full px-3 py-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
                    >
                      上传
                    </button>
                  )}

                  {uploadFile.status === 'uploading' && (
                    <div className="mt-2">
                      <div className="text-xs text-blue-500 mb-1">{uploadFile.message}</div>
                      <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadFile.progress}%` }}
                        ></div>
                      </div>
                      <button
                        onClick={() => handleCancelUpload(uploadFile.id)}
                        className="mt-1 w-full px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-xs"
                      >
                        取消
                      </button>
                    </div>
                  )}

                  {uploadFile.status === 'error' && (
                    <div className="mt-2">
                      <p className="text-xs text-red-500">{uploadFile.message}</p>
                      <button
                        onClick={() => setFiles((prev) =>
                          prev.map((f) => (f.id === uploadFile.id ? { ...f, status: 'pending', message: '' } : f))
                        )}
                        className="mt-1 w-full px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-xs"
                      >
                        重试
                      </button>
                    </div>
                  )}

                  {uploadFile.status === 'success' && (
                    <p className="mt-2 text-xs text-green-500">{uploadFile.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}