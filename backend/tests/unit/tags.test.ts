/**
 * @file 标签解析逻辑单元测试
 * @description 测试标签字符串的解析、分割和清理逻辑
 */

import { describe, it, expect } from 'vitest';

/**
 * 复现 photos.ts 中 /upload/complete 路由的标签解析逻辑
 * 支持：数组输入 / 中英文逗号分隔字符串
 */
function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

describe('parseTags 标签解析', () => {
  describe('数组输入', () => {
    it('应直接返回清理后的数组', () => {
      expect(parseTags(['风景', '人像', '夜景'])).toEqual(['风景', '人像', '夜景']);
    });

    it('应去除数组元素的前后空格', () => {
      expect(parseTags([' 风景 ', ' 人像', '夜景 '])).toEqual(['风景', '人像', '夜景']);
    });

    it('应过滤空字符串元素', () => {
      expect(parseTags(['风景', '', '  ', '夜景'])).toEqual(['风景', '夜景']);
    });

    it('应处理空数组', () => {
      expect(parseTags([])).toEqual([]);
    });

    it('应将非字符串元素转为字符串', () => {
      expect(parseTags([123, '风景', true])).toEqual(['123', '风景', 'true']);
    });
  });

  describe('英文逗号分隔', () => {
    it('应按英文逗号分割', () => {
      expect(parseTags('风景,人像,夜景')).toEqual(['风景', '人像', '夜景']);
    });

    it('应去除标签前后空格', () => {
      expect(parseTags(' 风景 , 人像 , 夜景 ')).toEqual(['风景', '人像', '夜景']);
    });

    it('应过滤空标签', () => {
      expect(parseTags('风景,,人像,')).toEqual(['风景', '人像']);
    });

    it('应处理仅含逗号的字符串', () => {
      expect(parseTags(',,,')).toEqual([]);
    });
  });

  describe('中文逗号分隔', () => {
    it('应按中文逗号分割', () => {
      expect(parseTags('风景，人像，夜景')).toEqual(['风景', '人像', '夜景']);
    });

    it('应去除标签前后空格', () => {
      expect(parseTags(' 风景 ， 人像 ， 夜景 ')).toEqual(['风景', '人像', '夜景']);
    });

    it('应过滤空标签', () => {
      expect(parseTags('风景，，人像，')).toEqual(['风景', '人像']);
    });
  });

  describe('混合逗号', () => {
    it('应同时处理中英文逗号', () => {
      expect(parseTags('风景,人像，夜景')).toEqual(['风景', '人像', '夜景']);
    });

    it('应处理混合逗号和空格', () => {
      expect(parseTags(' 风景 , 人像 ， 夜景 ')).toEqual(['风景', '人像', '夜景']);
    });

    it('应处理连续的混合逗号', () => {
      expect(parseTags('风景,，人像，，夜景')).toEqual(['风景', '人像', '夜景']);
    });
  });

  describe('边界条件', () => {
    it('应处理空字符串', () => {
      expect(parseTags('')).toEqual([]);
    });

    it('应处理仅含空格的字符串', () => {
      expect(parseTags('   ')).toEqual([]);
    });

    it('应处理单个标签', () => {
      expect(parseTags('风景')).toEqual(['风景']);
    });

    it('应处理单个带空格的标签', () => {
      expect(parseTags(' 风景 ')).toEqual(['风景']);
    });

    it('应处理 null 输入', () => {
      expect(parseTags(null)).toEqual([]);
    });

    it('应处理 undefined 输入', () => {
      expect(parseTags(undefined)).toEqual([]);
    });

    it('应处理数字输入', () => {
      expect(parseTags(123)).toEqual([]);
    });

    it('应处理对象输入', () => {
      expect(parseTags({ key: 'value' })).toEqual([]);
    });
  });

  describe('特殊标签内容', () => {
    it('应保留标签中的特殊字符', () => {
      expect(parseTags('C++,C#,JavaScript')).toEqual(['C++', 'C#', 'JavaScript']);
    });

    it('应处理含 emoji 的标签', () => {
      expect(parseTags('风景📸,人像👤')).toEqual(['风景📸', '人像👤']);
    });

    it('应处理含英文和中文混合的标签', () => {
      expect(parseTags('landscape风景,portrait人像')).toEqual(['landscape风景', 'portrait人像']);
    });

    it('应处理超长标签', () => {
      const longTag = 'A'.repeat(100);
      expect(parseTags(longTag)).toEqual([longTag]);
    });
  });
});
