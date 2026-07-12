import { useState, useCallback } from 'react';
import { getPresignedUrl, completeUpload } from '../api/photos';

interface UploadProgress {
  percentage: number;
  status: 'idle' | 'uploading' | 'success' | 'error';
  message: string;
}

interface PhotoUploaderProps {
  onSuccess?: (photoId: string, url: string) => void;
  onError?: (error: string) => void;
}

export function PhotoUploader({ onSuccess, onError }: PhotoUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress>({
    percentage: 0,
    status: 'idle',
    message: '',
  });
  
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
      if (!validTypes.includes(selectedFile.type)) {
        setProgress({ percentage: 0, status: 'error', message: '仅支持 JPG、PNG、WebP、HEIC 格式' });
        return;
      }
      if (selectedFile.size > 50 * 1024 * 1024) {
        setProgress({ percentage: 0, status: 'error', message: '文件大小不能超过 50MB' });
        return;
      }
      setFile(selectedFile);
      setProgress({ percentage: 0, status: 'idle', message: '' });
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;

    setProgress({ percentage: 0, status: 'uploading', message: '正在获取上传地址...' });

    try {
      const presignedResult = await getPresignedUrl(file.name);
      if (!presignedResult.success || !presignedResult.data) {
        setProgress({ percentage: 0, status: 'error', message: presignedResult.message || '获取上传地址失败' });
        onError?.(presignedResult.message || '获取上传地址失败');
        return;
      }

      const { uploadUrl, key } = presignedResult.data;
      setProgress({ percentage: 10, status: 'uploading', message: '正在上传图片...' });

      const controller = new AbortController();
      setAbortController(controller);

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

      setProgress({ percentage: 80, status: 'uploading', message: '正在保存照片信息...' });

      const completeResult = await completeUpload(key, {
        title: file.name.replace(/\.[^/.]+$/, ''),
      });

      if (!completeResult.success || !completeResult.data) {
        setProgress({ percentage: 0, status: 'error', message: completeResult.message || '保存照片信息失败' });
        onError?.(completeResult.message || '保存照片信息失败');
        return;
      }

      setProgress({ percentage: 100, status: 'success', message: '上传成功' });
      onSuccess?.(completeResult.data.photoId, completeResult.data.url);

      setTimeout(() => {
        setFile(null);
        setProgress({ percentage: 0, status: 'idle', message: '' });
      }, 2000);

    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setProgress({ percentage: 0, status: 'error', message: '上传已取消' });
      } else {
        const errorMsg = error instanceof Error ? error.message : '上传失败';
        setProgress({ percentage: 0, status: 'error', message: errorMsg });
        onError?.(errorMsg);
      }
    } finally {
      setAbortController(null);
    }
  }, [file, onSuccess, onError]);

  const handleCancel = useCallback(() => {
    abortController?.abort();
    setProgress({ percentage: 0, status: 'error', message: '上传已取消' });
    setAbortController(null);
  }, [abortController]);

  const handleReset = useCallback(() => {
    setFile(null);
    setProgress({ percentage: 0, status: 'idle', message: '' });
  }, []);

  return (
    <div className="w-full max-w-md mx-auto">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        onChange={handleFileChange}
        className="hidden"
        id="photo-upload-input"
      />

      <div
        className={`
          border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300
          ${file
            ? 'border-blue-500 bg-blue-50 hover:border-blue-600 hover:bg-blue-100'
            : progress.status === 'error'
              ? 'border-red-500 bg-red-50'
              : progress.status === 'success'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-blue-400'
          }
        `}
        onClick={() => !progress.status.includes('upload') && document.getElementById('photo-upload-input')?.click()}
      >
        {file && progress.status === 'idle' && (
          <div className="space-y-4">
            <div className="w-24 h-24 mx-auto rounded-lg overflow-hidden bg-gray-200">
              <img
                src={URL.createObjectURL(file)}
                alt="预览"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpload();
                }}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                开始上传
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
                className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                重新选择
              </button>
            </div>
          </div>
        )}

        {progress.status === 'uploading' && (
          <div className="space-y-4">
            <div className="relative w-24 h-24 mx-auto rounded-lg overflow-hidden bg-gray-200">
              <img
                src={URL.createObjectURL(file!)}
                alt="上传中"
                className="w-full h-full object-cover opacity-50"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">{progress.message}</div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                ></div>
              </div>
              <div className="text-xs text-gray-500 mt-1">{progress.percentage}%</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCancel();
              }}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              取消上传
            </button>
          </div>
        )}

        {progress.status === 'success' && (
          <div className="space-y-4">
            <div className="w-24 h-24 mx-auto rounded-lg overflow-hidden bg-green-100">
              <svg className="w-full h-full text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            <p className="text-green-600 font-medium">{progress.message}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              继续上传
            </button>
          </div>
        )}

        {progress.status === 'error' && !file && (
          <div className="space-y-4">
            <div className="w-24 h-24 mx-auto rounded-lg overflow-hidden bg-red-100">
              <svg className="w-full h-full text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </div>
            <p className="text-red-600 font-medium">{progress.message}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              重新上传
            </button>
          </div>
        )}

        {!file && progress.status === 'idle' && (
          <div className="space-y-4">
            <div className="w-24 h-24 mx-auto rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700">
              <svg className="w-full h-full text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
            </div>
            <p className="text-gray-600 dark:text-gray-300">点击或拖拽上传图片</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">支持 JPG、PNG、WebP、HEIC，最大 50MB</p>
          </div>
        )}
      </div>
    </div>
  );
}