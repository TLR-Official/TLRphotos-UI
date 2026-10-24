/**
 * @file 移动端上传 XHR 封装
 * @description
 *  与桌面端 UploadPage 的 directUpload 走同一后端链路（POST /api/photos/upload，
 *  FormData 直传服务端，由服务端生成缩略图/水印并写入 OSS），改用 XMLHttpRequest
 *  以获得 upload.onprogress 真实传输进度。
 *  注意：预签名链路（/upload/presigned + /upload/complete）后端不落库水印配置与
 *  structured_tags 结构化标签，为保证功能与桌面端一致，本页不采用该链路。
 */

import type { ApiResponse } from '../../../api/client';
import type { DirectUploadResponse, PhotoUploadMeta } from '../../../api/photos';

/** 上传句柄：结果 Promise 与取消函数 */
export interface UploadHandle {
  promise: Promise<ApiResponse<DirectUploadResponse>>;
  abort: () => void;
}

/** 网络层错误码（供调用方做指数退避重试判定） */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
/** 用户主动取消错误码 */
export const UPLOAD_ABORTED_CODE = 'UPLOAD_ABORTED';

/**
 * 以 XHR 上传单张照片并回报进度
 * @param file 图片文件
 * @param meta 照片元数据（与桌面端 directUpload 相同的扁平化 FormData 规则）
 * @param token 用户 JWT
 * @param onProgress 进度回调（0~95 为传输阶段，响应到达后置 100）
 * @returns UploadHandle
 */
export function uploadPhotoWithProgress(
  file: File,
  meta: PhotoUploadMeta & Record<string, unknown>,
  token: string | undefined,
  onProgress: (percent: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<ApiResponse<DirectUploadResponse>>((resolve) => {
    const formData = new FormData();
    formData.append('image', file);
    // 与桌面端 directUpload 一致：过滤 null / undefined，其余 String 化追加
    Object.entries(meta).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    });

    xhr.open('POST', '/api/photos/upload');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        // 传输阶段最多记 95%，剩余 5% 留给服务端图片处理（缩略图/水印/OSS 写入）
        onProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
      }
    };

    xhr.onload = () => {
      onProgress(100);
      try {
        // 透传后端业务错误码（HUMAN_VERIFICATION_REQUIRED / REGISTRATION_REQUIRED /
        // TAG_OBJECT_REQUIRED 等），供人机验证门与错误定位逻辑识别
        resolve(JSON.parse(xhr.responseText) as ApiResponse<DirectUploadResponse>);
      } catch {
        resolve({ success: false, message: `服务器返回异常响应（HTTP ${xhr.status}）` });
      }
    };

    xhr.onerror = () =>
      resolve({ success: false, code: NETWORK_ERROR_CODE, message: '网络异常，请检查网络连接' });
    xhr.ontimeout = () =>
      resolve({ success: false, code: NETWORK_ERROR_CODE, message: '网络超时，请检查网络连接' });
    xhr.onabort = () =>
      resolve({ success: false, code: UPLOAD_ABORTED_CODE, message: '已取消上传' });

    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}
