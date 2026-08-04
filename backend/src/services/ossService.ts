/**
 * @file OSS 存储服务
 * @description 封装阿里云 OSS（通过 S3 兼容协议访问）的文件上传、下载、删除与预签名 URL 生成能力。
 *              所有凭证通过环境变量注入，禁止硬编码。
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const OSS_REGION = process.env.OSS_REGION || 'oss-cn-hangzhou';
const OSS_ENDPOINT = process.env.OSS_ENDPOINT || `https://oss-${OSS_REGION}.aliyuncs.com`;
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID || '';
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET || '';
const OSS_BUCKET = process.env.OSS_BUCKET || '';

// 复用单一 S3Client 实例，避免每次请求重建连接
const s3Client = new S3Client({
  region: OSS_REGION,
  endpoint: OSS_ENDPOINT,
  credentials: {
    accessKeyId: OSS_ACCESS_KEY_ID,
    secretAccessKey: OSS_ACCESS_KEY_SECRET,
  },
  forcePathStyle: false,
});

/** 预签名上传 URL 响应：客户端凭此可直接 PUT 文件至 OSS */
export interface PresignedUploadUrl {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/** 上传完成结果：包含原图与缩略图的可访问 URL */
export interface UploadResult {
  key: string;
  url: string;
  thumbnailUrl: string;
}

/**
 * 根据原始文件名生成 OSS Key：时间戳 + 随机串避免冲突
 * @param originalName 原始文件名
 * @returns 形如 photos/{timestamp}_{random}.{ext} 的 Key
 */
export function generateFileKey(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString('hex');
  return `photos/${timestamp}_${randomStr}.${ext}`;
}

/**
 * 由原图 Key 推导缩略图 Key：扩展名替换为 webp，路径迁移到 thumbnails 目录
 * @param originalKey 原图 Key
 * @returns 缩略图 Key
 */
function generateThumbnailKey(originalKey: string): string {
  const parts = originalKey.split('.');
  parts[parts.length - 1] = 'webp';
  return parts.join('_thumb.').replace('/photos/', '/photos/thumbnails/');
}

/**
 * 生成预签名上传 URL（PUT 方式，1 小时有效）
 * @param originalName 原始文件名，用于推导 Key
 * @returns 预签名 URL 与对应 Key
 */
export async function generatePresignedUploadUrl(
  originalName: string
): Promise<PresignedUploadUrl> {
  const key = generateFileKey(originalName);

  const command = new PutObjectCommand({
    Bucket: OSS_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return {
    url,
    fields: {},
    key,
  };
}

/**
 * 获取文件可访问 URL：若已是完整 URL 则原样返回，否则生成 24 小时有效的预签名 URL
 * @param key OSS Key 或完整 URL
 * @returns 可直接访问的 URL
 */
export async function getFileUrl(key: string): Promise<string> {
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key;
  }

  const command = new GetObjectCommand({
    Bucket: OSS_BUCKET,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
  return url;
}

/**
 * 拼接公开访问 URL（不带签名，仅适用于公开读 bucket）
 * @param key OSS Key
 * @returns 公开访问 URL
 */
export function getPublicUrl(key: string): string {
  return `${OSS_ENDPOINT}/${OSS_BUCKET}/${key}`;
}

/**
 * 上传完成后返回原图与缩略图 URL
 * @param key 原图 OSS Key
 * @returns 原图与缩略图 URL
 */
export async function completeUpload(key: string): Promise<UploadResult> {
  const thumbnailKey = generateThumbnailKey(key);

  return {
    key,
    url: await getFileUrl(key),
    thumbnailUrl: await getFileUrl(thumbnailKey),
  };
}

/**
 * 同时获取原图与缩略图的可访问 URL
 * @param key 原图 OSS Key
 * @returns 原图与缩略图 URL
 */
export async function getPhotoUrls(key: string): Promise<{ url: string; thumbnailUrl: string }> {
  const thumbnailKey = generateThumbnailKey(key);
  return {
    url: await getFileUrl(key),
    thumbnailUrl: await getFileUrl(thumbnailKey),
  };
}

/**
 * 将 Buffer 直接上传至 OSS
 * @param buffer 文件二进制内容
 * @param key OSS Key
 * @param contentType MIME 类型
 * @returns 上传后的可访问 URL
 */
export async function uploadBufferToOSS(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: OSS_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return await getFileUrl(key);
}

/**
 * 删除 OSS 对象：仅对 Key 形式的路径执行删除，完整 URL 视为外部资源跳过
 * @param key OSS Key 或完整 URL
 */
export async function deleteFromOSS(key: string): Promise<void> {
  if (!key || key.startsWith('http://') || key.startsWith('https://')) {
    return;
  }

  const command = new DeleteObjectCommand({
    Bucket: OSS_BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}
