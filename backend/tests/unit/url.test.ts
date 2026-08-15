/**
 * @file URL 工具函数单元测试
 * @description 测试 getProxyUrl 和 escapeLikePattern 的各种输入场景
 */

import { describe, it, expect } from 'vitest';
import { getProxyUrl, escapeLikePattern } from '../../src/utils/url';

describe('getProxyUrl', () => {
  describe('纯 Key 输入', () => {
    it('应将纯 OSS Key 转换为代理 URL', () => {
      const result = getProxyUrl('photos/thumbnails/001.jpg');
      expect(result).toBe('/api/photos/image/photos%2Fthumbnails%2F001.jpg');
    });

    it('应正确编码特殊字符', () => {
      const result = getProxyUrl('photos/中文 文件.jpg');
      expect(result).toContain('/api/photos/image/');
      expect(result).toContain(encodeURIComponent('中文 文件.jpg'));
    });

    it('应处理带 photoId 的纯 Key', () => {
      const result = getProxyUrl('photos/001.jpg', '000123');
      expect(result).toBe('/api/photos/image/photos%2F001.jpg?photoId=000123');
    });

    it('应处理空字符串 Key', () => {
      const result = getProxyUrl('');
      expect(result).toBe('/api/photos/image/');
    });
  });

  describe('完整 URL 输入', () => {
    const ossDomain = 'https://tlr-main.oss-cn-hongkong.aliyuncs.com/';

    it('应将本系统 OSS URL 转换为代理 URL', () => {
      const result = getProxyUrl(`${ossDomain}photos/001.jpg`);
      expect(result).toBe('/api/photos/image/photos%2F001.jpg');
    });

    it('应剥离 OSS URL 的查询参数', () => {
      const result = getProxyUrl(`${ossDomain}photos/001.jpg?Expires=123&Signature=abc`);
      expect(result).toBe('/api/photos/image/photos%2F001.jpg');
      expect(result).not.toContain('Expires');
      expect(result).not.toContain('Signature');
    });

    it('应处理带 photoId 的 OSS URL', () => {
      const result = getProxyUrl(`${ossDomain}photos/001.jpg`, '000123');
      expect(result).toBe('/api/photos/image/photos%2F001.jpg?photoId=000123');
    });

    it('应原样返回外部 URL（非本系统 OSS）', () => {
      const externalUrl = 'https://example.com/image.jpg';
      const result = getProxyUrl(externalUrl);
      expect(result).toBe(externalUrl);
    });

    it('应原样返回 http 外部 URL', () => {
      const externalUrl = 'http://cdn.example.com/photo.png';
      const result = getProxyUrl(externalUrl);
      expect(result).toBe(externalUrl);
    });
  });

  describe('边界条件', () => {
    it('应处理 http 开头但非 OSS 的 URL', () => {
      const result = getProxyUrl('http://other-domain.com/photo.jpg');
      expect(result).toBe('http://other-domain.com/photo.jpg');
    });

    it('应处理深层路径 Key', () => {
      const deepKey = 'photos/previews/2024/08/15/001_preview.webp';
      const result = getProxyUrl(deepKey);
      expect(result).toBe(`/api/photos/image/${encodeURIComponent(deepKey)}`);
    });
  });
});

describe('escapeLikePattern', () => {
  it('应转义百分号', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
  });

  it('应转义下划线', () => {
    expect(escapeLikePattern('user_name')).toBe('user\\_name');
  });

  it('应同时转义多个特殊字符', () => {
    expect(escapeLikePattern('50%_off')).toBe('50\\%\\_off');
  });

  it('应不转义普通字符', () => {
    expect(escapeLikePattern('normal text')).toBe('normal text');
  });

  it('应处理空字符串', () => {
    expect(escapeLikePattern('')).toBe('');
  });

  it('应处理仅含特殊字符的字符串', () => {
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
  });

  it('应处理连续特殊字符', () => {
    expect(escapeLikePattern('___')).toBe('\\_\\_\\_');
  });
});
