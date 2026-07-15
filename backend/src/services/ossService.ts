import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const OSS_REGION = process.env.OSS_REGION || 'oss-cn-hangzhou';
const OSS_ENDPOINT = process.env.OSS_ENDPOINT || `https://oss-${OSS_REGION}.aliyuncs.com`;
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID || '';
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET || '';
const OSS_BUCKET = process.env.OSS_BUCKET || '';

const s3Client = new S3Client({
  region: OSS_REGION,
  endpoint: OSS_ENDPOINT,
  credentials: {
    accessKeyId: OSS_ACCESS_KEY_ID,
    secretAccessKey: OSS_ACCESS_KEY_SECRET,
  },
  forcePathStyle: false,
});

export interface PresignedUploadUrl {
  url: string;
  fields: Record<string, string>;
  key: string;
}

export interface UploadResult {
  key: string;
  url: string;
  thumbnailUrl: string;
}

export function generateFileKey(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(8).toString('hex');
  return `photos/${timestamp}_${randomStr}.${ext}`;
}

function generateThumbnailKey(originalKey: string): string {
  const parts = originalKey.split('.');
  parts[parts.length - 1] = 'webp';
  return parts.join('_thumb.').replace('/photos/', '/photos/thumbnails/');
}

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

export function getPublicUrl(key: string): string {
  return `${OSS_ENDPOINT}/${OSS_BUCKET}/${key}`;
}

export async function completeUpload(key: string): Promise<UploadResult> {
  const thumbnailKey = generateThumbnailKey(key);

  return {
    key,
    url: await getFileUrl(key),
    thumbnailUrl: await getFileUrl(thumbnailKey),
  };
}

export async function getPhotoUrls(key: string): Promise<{ url: string; thumbnailUrl: string }> {
  const thumbnailKey = generateThumbnailKey(key);
  return {
    url: await getFileUrl(key),
    thumbnailUrl: await getFileUrl(thumbnailKey),
  };
}

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