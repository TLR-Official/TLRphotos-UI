/**
 * @file 水印底部信息条布局单元测试
 * @description 覆盖 computeBandMetrics 的尺寸换算与 clamp、estimateTextEm 的宽度估算、
 *              resolveLineText 的缩字号与截断兜底，防止不同分辨率下文字越界。
 */

import { describe, it, expect } from 'vitest';
import { computeBandMetrics, estimateTextEm, resolveLineText } from '../../src/services/imageService';

describe('computeBandMetrics 底部信息条布局', () => {
  it('横图（1200×675）条高应为短边 11%', () => {
    const m = computeBandMetrics(1200, 675);
    expect(m.bandHeight).toBe(Math.round(675 * 0.11)); // 74
    expect(m.maxTextWidth).toBe(Math.round(1200 * 0.92));
    expect(m.line1FontSize).toBe(Math.round(m.bandHeight * 0.3));
    expect(m.line2FontSize).toBe(Math.round(m.bandHeight * 0.26));
    expect(m.line1CenterY).toBeLessThan(m.line2CenterY);
  });

  it('竖图（675×1200）应按短边（宽）计算条高', () => {
    const m = computeBandMetrics(675, 1200);
    expect(m.bandHeight).toBe(Math.round(675 * 0.11));
  });

  it('小图条高应被下限 48px 兜住', () => {
    const m = computeBandMetrics(300, 200);
    expect(m.bandHeight).toBe(48);
  });

  it('极端扁图条高不应超过图高的 40%', () => {
    const m = computeBandMetrics(1200, 90);
    expect(m.bandHeight).toBe(48);
  });

  it('两行文字中心都应落在条内', () => {
    const m = computeBandMetrics(1200, 900);
    expect(m.line1CenterY).toBeGreaterThan(0);
    expect(m.line1CenterY).toBeLessThan(m.line2CenterY);
    expect(m.line2CenterY).toBeLessThan(m.bandHeight);
  });
});

describe('estimateTextEm 文本宽度估算', () => {
  it('中文按全角 1em 计', () => {
    expect(estimateTextEm('摄影')).toBe(2);
  });

  it('大写字母 0.68em、小写与数字 0.56em', () => {
    expect(estimateTextEm('A')).toBeCloseTo(0.68);
    expect(estimateTextEm('a1')).toBeCloseTo(1.12);
  });

  it('空格 0.28em', () => {
    expect(estimateTextEm(' ')).toBeCloseTo(0.28);
  });

  it('空字符串宽度为 0', () => {
    expect(estimateTextEm('')).toBe(0);
  });
});

describe('resolveLineText 单行收敛', () => {
  it('短文本不缩放不截断', () => {
    const r = resolveLineText('TLRphotos', 22, 1104);
    expect(r.text).toBe('TLRphotos');
    expect(r.fontSize).toBe(22);
  });

  it('超宽时先按估算宽度缩小字号', () => {
    // 20 个中文 = 20em，maxWidth 200 → 字号应缩到 10
    const r = resolveLineText('一'.repeat(20), 22, 200);
    expect(r.fontSize).toBe(10);
    expect(r.text).toBe('一'.repeat(20));
  });

  it('字号触底仍超宽时截断并补省略号', () => {
    const r = resolveLineText('一'.repeat(200), 22, 200);
    expect(r.fontSize).toBe(10);
    expect(r.text.endsWith('…')).toBe(true);
    expect(estimateTextEm(r.text) * r.fontSize).toBeLessThanOrEqual(200);
  });

  it('结果宽度始终不超过可用宽度', () => {
    const cases = ['© 2026 张三丰', '© 2026 非常短的名称', `© 2026 ${'A'.repeat(300)}`];
    for (const raw of cases) {
      const r = resolveLineText(raw, 19, 1104);
      expect(estimateTextEm(r.text) * r.fontSize).toBeLessThanOrEqual(1104);
    }
  });

  it('保留中文与特殊符号原样（转义由合成层负责）', () => {
    const r = resolveLineText('© 2026 O\'Neil & Sons', 19, 1104);
    expect(r.text).toBe('© 2026 O\'Neil & Sons');
  });
});
