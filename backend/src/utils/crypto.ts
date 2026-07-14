import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || generateDefaultKey();

function generateDefaultKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

const KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, 'base64');
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BUFFER, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`;
}

export function decrypt(encryptedText: string): string {
  const [ivBase64, encryptedBase64, authTagBase64] = encryptedText.split(':');
  
  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(ivBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY_BUFFER, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
