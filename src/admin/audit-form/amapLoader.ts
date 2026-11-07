/**
 * @file amapLoader - 高德地图 JS API 2.0 懒加载器（V4.10.1）
 * @description
 *  仅在审核员展开地图选点时注入脚本，不影响审核详情页首屏。
 *  配置来源优先级：
 *    1. 构建期 VITE_AMAP_KEY / VITE_AMAP_SECURITY_CODE（可选覆盖）；
 *    2. 运行时 GET /api/config/public（后端 AMAP_JS_KEY / AMAP_JS_SECURITY_CODE 下发）。
 *  运行时下发使修改 Key 只需重启后端，无需重新构建前端；未配置时抛 AMAP_NOT_CONFIGURED，
 *  由调用方展示提示并保留文本 / EXIF 两种输入方式（fail-soft）。
 */

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

/** 地图配置（Key 为客户端公开凭证） */
interface AmapConfig {
  key: string;
  securityCode: string;
}

/** 脚本标签标记，避免重复注入 */
const SCRIPT_FLAG = 'amapLoader';

/** 配置解析 Promise（一次页面生命周期只解析一次） */
let configPromise: Promise<AmapConfig> | null = null;
/** 脚本加载 Promise（并发调用共享） */
let loadPromise: Promise<any> | null = null;

/**
 * 解析地图配置：构建期注入优先，否则读取后端公开配置接口。
 * 任何失败都降级为空 Key，由 loadAmap 统一抛 AMAP_NOT_CONFIGURED。
 */
async function resolveAmapConfig(): Promise<AmapConfig> {
  const buildKey = (import.meta.env.VITE_AMAP_KEY as string | undefined)?.trim();
  if (buildKey) {
    return {
      key: buildKey,
      securityCode: (import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined)?.trim() || '',
    };
  }

  try {
    const response = await fetch('/api/config/public', { headers: { Accept: 'application/json' } });
    if (!response.ok) return { key: '', securityCode: '' };
    const payload = await response.json();
    return {
      key: String(payload?.data?.amap_js_key ?? '').trim(),
      securityCode: String(payload?.data?.amap_security_code ?? '').trim(),
    };
  } catch {
    return { key: '', securityCode: '' };
  }
}

/** 获取（并缓存）配置 */
function getConfig(): Promise<AmapConfig> {
  if (!configPromise) {
    configPromise = resolveAmapConfig();
  }
  return configPromise;
}

/**
 * 注入 JS API 脚本。
 * @param key 高德 Web 端 Key
 */
function injectScript(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-${SCRIPT_FLAG}]`);
    if (existing) {
      // 已注入但可能仍在加载：等待其完成
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('AMAP_LOAD_FAILED')));
      if (window.AMap) resolve();
      return;
    }

    const script = document.createElement('script');
    script.dataset[SCRIPT_FLAG] = '1';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('AMAP_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

/**
 * 加载高德 JS API（含逆地理编码插件）。
 * @returns AMap 命名空间
 * @throws AMAP_NOT_CONFIGURED 未配置 Key；AMAP_LOAD_FAILED 脚本加载失败
 */
export function loadAmap(): Promise<any> {
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const config = await getConfig();
    if (!config.key) {
      throw new Error('AMAP_NOT_CONFIGURED');
    }

    // 2.0 起必须在使用插件前声明安全密钥
    if (config.securityCode) {
      window._AMapSecurityConfig = { securityJsCode: config.securityCode };
    }

    await injectScript(config.key);
    if (!window.AMap) {
      throw new Error('AMAP_LOAD_FAILED');
    }
    return window.AMap;
  })().catch((error) => {
    // 失败后清空单例，允许用户重试
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}
