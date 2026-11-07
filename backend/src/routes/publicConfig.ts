/**
 * @file publicConfig.ts
 * @description 公开配置接口（V4.10.1）。
 *              仅下发客户端必需的公开凭证，避免把 Key 固化在前端构建产物中：
 *              高德地图 JS API 的 Web 端 Key 与安全密钥本就会在浏览器中使用，
 *              安全边界由高德控制台的域名白名单保证，因此无需鉴权。
 *              未配置时返回 null，前端据此展示配置提示（fail-soft）。
 */
import express from 'express';

const router = express.Router();

/** 读取环境变量并 trim，空值归一为 null */
function readEnv(name: string): string | null {
  const value = (process.env[name] || '').trim();
  return value || null;
}

/**
 * 获取公开配置。
 * GET /api/config/public
 * 响应：{ success: true, data: { amap_js_key, amap_security_code } }
 */
router.get('/public', (_req, res) => {
  // 配置仅在进程启动时读取，缓存 5 分钟可显著减少请求；重启后端即立即生效
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    success: true,
    data: {
      amap_js_key: readEnv('AMAP_JS_KEY'),
      amap_security_code: readEnv('AMAP_JS_SECURITY_CODE'),
    },
  });
});

export default router;
