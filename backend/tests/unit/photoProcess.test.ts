import { describe, expect, it } from 'vitest';
import { resolveDetailScale } from '../../src/services/photoProcessService';

describe('详情页压缩比例（PRD 4.3）', () => {
  it('0–500KB 使用 100%', () => {
    expect(resolveDetailScale(0)).toBe(1);
    expect(resolveDetailScale(300 * 1024)).toBe(1);
    expect(resolveDetailScale(500 * 1024)).toBe(1);
  });

  it('500KB–1MB 使用 80%', () => {
    expect(resolveDetailScale(500 * 1024 + 1)).toBe(0.8);
    expect(resolveDetailScale(1024 * 1024)).toBe(0.8);
  });

  it('1–5MB 使用 60%', () => {
    expect(resolveDetailScale(1024 * 1024 + 1)).toBe(0.6);
    expect(resolveDetailScale(5 * 1024 * 1024)).toBe(0.6);
  });

  it('5–10MB 使用 50%', () => {
    expect(resolveDetailScale(5 * 1024 * 1024 + 1)).toBe(0.5);
    expect(resolveDetailScale(10 * 1024 * 1024)).toBe(0.5);
  });

  it('超过 10MB 使用 40%', () => {
    expect(resolveDetailScale(10 * 1024 * 1024 + 1)).toBe(0.4);
    expect(resolveDetailScale(50 * 1024 * 1024)).toBe(0.4);
  });
});
