/**
 * @file amapLoader - 高德地图 JS API 2.0 懒加载器（V4.10.0）
 * @description
 *  仅在审核员展开地图选点时注入脚本，不影响审核详情页首屏。
 *  Key 与安全密钥通过构建期环境变量注入：
 *    VITE_AMAP_KEY / VITE_AMAP_SECURITY_CODE
 *  未配置 Key 时不加载脚本，由调用方展示配置提示（fail-soft）。
 */

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

/** 高德 Web 端 Key（构建期注入） */
const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined)?.trim();
/** 高德 JS API 2.0 安全密钥（逆地理编码等插件必需） */
const AMAP_SECURITY_CODE = (import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined)?.trim();

/** 单例加载 Promise，避免重复注入脚本 */
let loadPromise: Promise<any> | null = null;

/** 是否已配置高德 Key */
export function isAmapConfigured(): boolean {
  return !!AMAP_KEY;
}

/**
 * 加载高德 JS API（含逆地理编码插件）。
 * @returns AMap 命名空间
 */
export function loadAmap(): Promise<any> {
  if (!AMAP_KEY) {
    return Promise.reject(new Error('AMAP_NOT_CONFIGURED'));
  }
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }
  if (loadPromise) {
    return loadPromise;
  }

  // 2.0 起必须在使用插件前声明安全密钥
  if (AMAP_SECURITY_CODE) {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_KEY)}&plugin=AMap.Geocoder`;
    script.async = true;
    script.onload = () => {
      if (window.AMap) {
        resolve(window.AMap);
      } else {
        loadPromise = null;
        reject(new Error('AMAP_LOAD_FAILED'));
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('AMAP_LOAD_FAILED'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
