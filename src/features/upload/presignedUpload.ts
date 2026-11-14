/**
 * @file 预签名 OSS 直传（V4.13.0，PRD 4.5 方案 A）
 * @description
 *  上传链路：申请预签名 URL → 浏览器 PUT 原图至 OSS（XHR 真实进度）→ 完成回调落库。
 *  原图不经过本站服务器磁盘；服务端在完成回调中登记异步水印/压缩任务，
 *  用户端立即进入上传成功页，不等待派生图生成。
 *  桌面端与移动端上传页共用；返回结构兼容原 directUpload，便于人机验证门直接复用。
 */

import type { ApiResponse } from '../../api/client';
import type { DirectUploadResponse, PhotoUploadMeta } from '../../api/photos';

/** 网络层错误码（供调用方做指数退避重试判定） */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
/** 用户主动取消错误码 */
export const UPLOAD_ABORTED_CODE = 'UPLOAD_ABORTED';

/** 上传句柄：结果 Promise 与取消函数 */
export interface PresignedUploadHandle {
  promise: Promise<ApiResponse<DirectUploadResponse>>;
  abort: () => void;
}

/** 解析后端 JSON 响应，失败时返回统一错误结构 */
async function parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    const data = (await response.json()) as ApiResponse<T>;
    if (!response.ok && data.success !== false) {
      return { success: false, message: `请求失败（HTTP ${response.status}）` };
    }
    return data;
  } catch {
    return { success: false, message: `服务器返回异常响应（HTTP ${response.status}）` };
  }
}

/**
 * 以预签名方式上传单张照片并回报进度
 * @param file 图片文件
 * @param meta 照片元数据（标题/标签/分区字段/EXIF/水印配置）
 * @param token 用户 JWT
 * @param onProgress 进度回调（0~100）
 * @returns PresignedUploadHandle
 */
export function uploadPhotoViaPresigned(
  file: File,
  meta: PhotoUploadMeta & Record<string, unknown>,
  token: string | undefined,
  onProgress: (percent: number) => void,
): PresignedUploadHandle {
  const controller = new AbortController();
  let putXhr: XMLHttpRequest | null = null;
  let aborted = false;

  const promise = (async (): Promise<ApiResponse<DirectUploadResponse>> => {
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // 1) 申请预签名 URL（同时完成人机验证门校验）
    onProgress(2);
    let presignResponse: Response;
    try {
      presignResponse = await fetch('/api/photos/upload/presigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ fileName: file.name }),
        signal: controller.signal,
      });
    } catch {
      return aborted
        ? { success: false, code: UPLOAD_ABORTED_CODE, message: '已取消上传' }
        : { success: false, code: NETWORK_ERROR_CODE, message: '网络异常，请检查网络连接' };
    }

    const presign = await parseResponse<{ uploadUrl: string; key: string }>(presignResponse);
    if (!presign.success || !presign.data) {
      return {
        success: false,
        code: presign.code,
        message: presign.message || '获取上传地址失败',
      };
    }

    const { uploadUrl, key } = presign.data;

    // 2) 浏览器直传 OSS 原图，XHR 提供真实传输进度
    onProgress(5);
    const putResult = await new Promise<ApiResponse<null>>((resolve) => {
      const xhr = new XMLHttpRequest();
      putXhr = xhr;
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(5 + Math.round((event.loaded / event.total) * 85));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true });
        } else {
          resolve({ success: false, message: `原图直传失败（HTTP ${xhr.status}）` });
        }
      };
      xhr.onerror = () =>
        resolve({ success: false, code: NETWORK_ERROR_CODE, message: '网络异常，请检查网络连接' });
      xhr.ontimeout = () =>
        resolve({ success: false, code: NETWORK_ERROR_CODE, message: '网络超时，请检查网络连接' });
      xhr.onabort = () => resolve({ success: false, code: UPLOAD_ABORTED_CODE, message: '已取消上传' });

      xhr.send(file);
    });

    putXhr = null;
    if (!putResult.success) return putResult as unknown as ApiResponse<DirectUploadResponse>;

    // 3) 完成回调：服务端确认 OSS 对象、落库并登记异步处理任务后立即返回
    onProgress(92);
    let completeResponse: Response;
    try {
      completeResponse = await fetch('/api/photos/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ key, ...meta }),
        signal: controller.signal,
      });
    } catch {
      return aborted
        ? { success: false, code: UPLOAD_ABORTED_CODE, message: '已取消上传' }
        : { success: false, code: NETWORK_ERROR_CODE, message: '网络异常，请检查网络连接' };
    }

    const complete = await parseResponse<DirectUploadResponse>(completeResponse);
    if (complete.success) onProgress(100);
    return complete;
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      controller.abort();
      putXhr?.abort();
    },
  };
}
