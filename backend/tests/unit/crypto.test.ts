/**
 * @file 加密工具单元测试
 * @description 测试 AES-256-GCM 加解密函数的正确性、边界条件和异常处理
 */

import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

// 设置测试用密钥（32 字节 base64）
const TEST_KEY = crypto.randomBytes(32).toString('base64');
process.env.ENCRYPTION_KEY = TEST_KEY;

// 必须在设置环境变量后导入模块，确保使用测试密钥
import { encrypt, decrypt } from '../../src/utils/crypto';

describe('encrypt / decrypt', () => {
  describe('基本加解密', () => {
    it('应正确加解密普通字符串', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应正确加解密中文内容', () => {
      const plaintext = '这是一段需要加密的中文内容 🎉';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应正确加解密 JSON 字符串', () => {
      const plaintext = JSON.stringify({ ip: '192.168.1.1', ua: 'Mozilla/5.0' });
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(JSON.parse(decrypted)).toEqual({ ip: '192.168.1.1', ua: 'Mozilla/5.0' });
    });

    it('应正确加解密空字符串', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('密文格式', () => {
    it('加密结果应为 iv:ciphertext:authTag 格式', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      // 每部分都应是有效的 base64
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('相同明文多次加密应产生不同密文（IV 随机化）', () => {
      const plaintext = 'same content';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      // 但解密后应相同
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe('异常处理', () => {
    it('解密非法格式应抛出错误', () => {
      expect(() => decrypt('invalid-format')).toThrow();
    });

    it('解密空字符串应抛出错误', () => {
      expect(() => decrypt('')).toThrow();
    });

    it('解密缺少 authTag 的密文应抛出错误', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      expect(() => decrypt(`${parts[0]}:${parts[1]}`)).toThrow();
    });

    it('解密被篡改的密文应抛出认证错误', () => {
      const encrypted = encrypt('secret data');
      const parts = encrypted.split(':');
      // 篡改密文部分
      const tamperedCiphertext = parts[1].slice(0, -2) + 'XX';
      const tampered = `${parts[0]}:${tamperedCiphertext}:${parts[2]}`;

      expect(() => decrypt(tampered)).toThrow();
    });

    it('解密被篡改的 authTag 应抛出认证错误', () => {
      const encrypted = encrypt('secret data');
      const parts = encrypted.split(':');
      // 篡改 authTag
      const tamperedAuthTag = parts[2].slice(0, -2) + 'XX';
      const tampered = `${parts[0]}:${parts[1]}:${tamperedAuthTag}`;

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('长文本和特殊字符', () => {
    it('应正确加解密超长文本', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(decrypted.length).toBe(10000);
    });

    it('应正确加解密含特殊字符的文本', () => {
      const plaintext = 'Special: !@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('应正确加解密含换行符的文本', () => {
      const plaintext = 'Line 1\nLine 2\nLine 3';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});
