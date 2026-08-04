/**
 * @file 加密工具
 * @description 基于 AES-256-GCM 提供对称加解密能力，用于敏感字段（如会话 IP）的入库保护。
 *              密钥通过环境变量 ENCRYPTION_KEY 注入，未配置时进程级生成临时密钥（仅当前进程可用）。
 */

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || generateDefaultKey();

/**
 * 生成默认密钥：仅当环境变量缺失时使用，进程重启后失效，无法解密历史数据
 * @returns base64 编码的 32 字节随机密钥
 */
function generateDefaultKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, 'base64');
// GCM 推荐 IV 长度为 12 字节
const IV_LENGTH = 12;
// GCM 认证标签长度固定 16 字节
const AUTH_TAG_LENGTH = 16;

/**
 * 加密明文字符串
 * @param text 待加密明文
 * @returns 形如 {iv}:{ciphertext}:{authTag} 的 base64 组合串
 */
export function encrypt(text: string): string {
  // 每次加密生成随机 IV，防止相同明文产生相同密文
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BUFFER, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // 认证标签用于解密时校验密文完整性，防止篡改
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
}

/**
 * 解密由 encrypt 产出的密文字符串
 * @param encryptedText 形如 {iv}:{ciphertext}:{authTag} 的组合串
 * @returns 原始明文
 * @throws 当格式非法或认证标签校验失败时抛出错误
 */
export function decrypt(encryptedText: string): string {
  const [ivBase64, encryptedBase64, authTagBase64] = encryptedText.split(':');

  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BUFFER, iv);
  // setAuthTag 必须在 update 之前调用，否则解密会失败
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
