/**
 * @file rateLimit 单元测试（V1.10.1）
 * @description 验证固定窗口计数、429 + Retry-After、窗口重置与按 IP 隔离。
 *  通过 RATE_LIMIT_ENABLED=1 在测试环境显式开启限速器。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../../src/middleware/rateLimit';

interface MockOut {
  res: Response;
  status: number;
  body: any;
  headers: Record<string, string | number>;
}

/** 构造最小 mock 请求（可覆盖 IP） */
function mockReq(ip = '203.0.113.7'): Partial<Request> {
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: '127.0.0.1' } as any,
    baseUrl: '/api/auth',
    path: '/login',
  };
}

/** 收集响应状态、体与响应头 */
function mockRes(): MockOut {
  const out: MockOut = { status: 200, body: null, headers: {} } as MockOut;
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: any) {
      out.body = payload;
    },
    setHeader(name: string, value: string | number) {
      out.headers[name] = value;
    },
  };
  out.res = res as unknown as Response;
  return out;
}

describe('createRateLimiter', () => {
  beforeAll(() => {
    process.env.RATE_LIMIT_ENABLED = '1';
  });
  afterAll(() => {
    delete process.env.RATE_LIMIT_ENABLED;
  });

  it('窗口内超过 max 返回 429 + Retry-After', () => {
    const limiter = createRateLimiter({ max: 2, message: 'too many' });
    for (let i = 0; i < 2; i++) {
      const out = mockRes();
      limiter(mockReq() as Request, out.res, (() => {}) as NextFunction);
      expect(out.status).toBe(200);
    }
    const blocked = mockRes();
    limiter(mockReq() as Request, blocked.res, (() => {}) as NextFunction);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('窗口过期后重新放行', async () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 30 });
    const first = mockRes();
    limiter(mockReq() as Request, first.res, (() => {}) as NextFunction);
    const second = mockRes();
    limiter(mockReq() as Request, second.res, (() => {}) as NextFunction);
    expect(second.status).toBe(429);
    await new Promise((r) => setTimeout(r, 45));
    const afterReset = mockRes();
    limiter(mockReq() as Request, afterReset.res, (() => {}) as NextFunction);
    expect(afterReset.status).toBe(200);
  });

  it('不同 IP 独立计数', () => {
    const limiter = createRateLimiter({ max: 1 });
    const a = mockRes();
    limiter(mockReq() as Request, a.res, (() => {}) as NextFunction);
    const b = mockRes();
    limiter(mockReq('198.51.100.9') as Request, b.res, (() => {}) as NextFunction);
    expect(b.status).toBe(200);
  });
});
