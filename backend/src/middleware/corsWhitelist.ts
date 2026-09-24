/**
 * @file corsWhitelist.ts
 * @description CORS 白名单中间件（V1.10.1 安全修复）。
 *  由通配 Access-Control-Allow-Origin: * 收紧为业务域名白名单：
 *   - 白名单经 CORS_ALLOWED_ORIGINS env 注入（逗号分隔），默认仅本站三个域名；
 *   - 无 Origin 的同源/服务端/健康检查请求放行；
 *   - 非白名单来源 → 403 CORS_BLOCKED（交由全局 errorHandler 响应）；
 *   - 仅声明实际使用的方法 GET/POST/PUT/DELETE 与必要请求头，不携带凭证。
 */
import cors from 'cors';

/** 读取白名单域名（默认仅本站域名） */
export function getAllowedOrigins(): string[] {
  return (
    process.env.CORS_ALLOWED_ORIGINS ||
    'https://tlrphotos.com,https://www.tlrphotos.com,https://admin.tlrphotos.com'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 配置好的 CORS 中间件 */
export const corsWhitelist = cors({
  origin: (origin, cb) => {
    if (!origin || getAllowedOrigins().includes(origin)) {
      cb(null, true);
      return;
    }
    cb(Object.assign(new Error('CORS blocked'), { code: 'CORS_BLOCKED', status: 403 }));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
  credentials: false,
  maxAge: 86400,
});
