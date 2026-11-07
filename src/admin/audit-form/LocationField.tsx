/**
 * @file LocationField - 审核端「拍摄地点」字段（V4.10.0）
 * @description
 *  一个字段承载三种输入方式，彼此覆盖：
 *    1. 文本手输：直接编辑地址文本；编辑时清空经纬度，避免地址与坐标不一致；
 *    2. EXIF 读取：从原图 EXIF 读取 GPS，写入坐标与「纬度, 经度」文本；
 *    3. 地图选点：展开高德地图，点击/拖动标记选点，逆地理编码回填地址与坐标。
 *  进入页面时若地点与坐标皆为空，自动尝试一次 EXIF；其余情况手动触发。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import { isAmapConfigured, loadAmap } from './amapLoader';
import { formatCoordinates, readExifLocation } from './exifLocation';

/** 拍摄地点草稿（受控） */
export interface LocationDraft {
  location: string;
  latitude: number | null;
  longitude: number | null;
}

interface LocationFieldProps {
  /** 当前草稿 */
  value: LocationDraft;
  /** 变更回调（最新一次输入方式覆盖前值） */
  onChange: (next: LocationDraft) => void;
  /** 原图地址（EXIF 必须读原图，预览图已剥离 EXIF） */
  originalUrl: string;
  /** 管理员 JWT（未审核照片需要鉴权） */
  authToken?: string;
  /** 提交中禁用交互 */
  disabled?: boolean;
}

/** EXIF 读取状态 */
type ExifState = 'idle' | 'reading' | 'hit' | 'miss';

/** 默认地图中心（天安门），仅在照片无坐标时使用 */
const DEFAULT_CENTER: [number, number] = [116.397428, 39.90923];

export function LocationField({ value, onChange, originalUrl, authToken, disabled = false }: LocationFieldProps) {
  const [exifState, setExifState] = useState<ExifState>('idle');
  const [mapOpen, setMapOpen] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const exifAbortRef = useRef<AbortController | null>(null);
  // 自动 EXIF 只对每张照片尝试一次
  const autoTriedRef = useRef('');

  // 回调与当前值放入 ref，供地图事件（非 React 事件）读取最新值
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  useEffect(() => {
    onChangeRef.current = onChange;
    valueRef.current = value;
  }, [onChange, value]);

  /** 读取原图 EXIF 并回填坐标与地址 */
  const handleReadExif = useCallback(async () => {
    if (!originalUrl || disabled) return;
    exifAbortRef.current?.abort();
    const controller = new AbortController();
    exifAbortRef.current = controller;

    setExifState('reading');
    const coords = await readExifLocation(originalUrl, authToken, controller.signal);
    if (controller.signal.aborted) return;

    if (coords) {
      setExifState('hit');
      onChangeRef.current({
        location: formatCoordinates(coords.latitude, coords.longitude),
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    } else {
      setExifState('miss');
    }
  }, [originalUrl, authToken, disabled]);

  // 进入页面：地点与坐标都为空时自动尝试一次 EXIF（同一张照片不重复）
  useEffect(() => {
    if (!originalUrl || autoTriedRef.current === originalUrl) return;
    autoTriedRef.current = originalUrl;
    if (valueRef.current.location || valueRef.current.latitude != null) return;
    void handleReadExif();
  }, [originalUrl, handleReadExif]);

  // 卸载时中止 EXIF 请求
  useEffect(() => {
    return () => {
      exifAbortRef.current?.abort();
    };
  }, []);

  // 地图初始化与销毁：仅在展开时加载脚本，收起即销毁实例
  useEffect(() => {
    if (!mapOpen) return;
    if (!isAmapConfigured()) {
      setMapError('未配置高德地图 Key（VITE_AMAP_KEY），可继续使用手动输入或 EXIF 读取');
      return;
    }

    let disposed = false;
    setMapLoading(true);
    setMapError('');

    loadAmap()
      .then((AMap) => {
        if (disposed || !containerRef.current) return;

        const current = valueRef.current;
        const center: [number, number] =
          current.latitude != null && current.longitude != null
            ? [current.longitude, current.latitude]
            : DEFAULT_CENTER;

        const map = new AMap.Map(containerRef.current, { zoom: 11, center });
        const marker = new AMap.Marker({ position: center, draggable: true });
        const geocoder = new AMap.Geocoder({ radius: 1000 });

        mapRef.current = map;
        markerRef.current = marker;
        geocoderRef.current = geocoder;

        if (current.latitude != null && current.longitude != null) {
          map.add(marker);
        }

        /** 落点后同步坐标并逆地理编码为地址文本 */
        const applyPoint = (lng: number, lat: number) => {
          marker.setPosition([lng, lat]);
          map.add(marker);
          geocoder.getAddress([lng, lat], (status: string, result: any) => {
            const formatted = status === 'complete' ? result?.regeocode?.formattedAddress : '';
            onChangeRef.current({
              location: formatted || formatCoordinates(lat, lng),
              latitude: lat,
              longitude: lng,
            });
          });
        };

        map.on('click', (e: any) => {
          applyPoint(e.lngLat.getLng(), e.lngLat.getLat());
        });
        marker.on('dragend', (e: any) => {
          applyPoint(e.lngLat.getLng(), e.lngLat.getLat());
        });

        setMapLoading(false);
      })
      .catch((err: Error) => {
        if (disposed) return;
        setMapLoading(false);
        setMapError(
          err.message === 'AMAP_NOT_CONFIGURED'
            ? '未配置高德地图 Key（VITE_AMAP_KEY），可继续使用手动输入或 EXIF 读取'
            : '地图加载失败，请检查网络后重试'
        );
      });

    return () => {
      disposed = true;
      try {
        mapRef.current?.destroy?.();
      } catch {
        // 地图实例销毁失败不影响页面
      }
      mapRef.current = null;
      markerRef.current = null;
      geocoderRef.current = null;
    };
  }, [mapOpen]);

  const exifHint =
    exifState === 'reading'
      ? '正在读取原图 EXIF…'
      : exifState === 'hit'
        ? '已从 EXIF 读取拍摄坐标'
        : exifState === 'miss'
          ? '未找到 GPS 信息，可手动输入或地图选点'
          : '';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-gray-500 text-xs">拍摄地点</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || exifState === 'reading'}
            onClick={() => void handleReadExif()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-300 bg-white text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${exifState === 'reading' ? 'animate-spin' : ''}`} />
            读取 EXIF
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMapOpen((v) => !v)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors disabled:opacity-50 ${
              mapOpen
                ? 'border-blue-700 bg-blue-700 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
            }`}
            aria-pressed={mapOpen}
          >
            <MapPin className="w-3 h-3" />
            {mapOpen ? '收起地图' : '地图选点'}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={value.location}
        disabled={disabled}
        maxLength={200}
        placeholder="如 上海市浦东新区（选填）"
        onChange={(e) => {
          // 手动改地址后原坐标不再对应，一并清空
          onChange({ location: e.target.value, latitude: null, longitude: null });
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
      />

      <div className="flex items-center justify-between gap-2 mt-1">
        <p className={`text-xs ${exifState === 'miss' ? 'text-yellow-700' : 'text-gray-400'}`}>{exifHint}</p>
        {value.latitude != null && value.longitude != null && (
          <p className="text-xs text-gray-400 font-mono shrink-0">
            {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
          </p>
        )}
      </div>

      {mapOpen && (
        <div className="mt-2">
          {mapError ? (
            <div className="px-3 py-4 rounded-lg border border-yellow-300 bg-yellow-50 text-xs text-yellow-800">
              {mapError}
            </div>
          ) : (
            <div className="relative">
              <div ref={containerRef} className="w-full h-64 rounded-lg border border-gray-200 bg-gray-50" />
              {mapLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 bg-white/60 rounded-lg">
                  地图加载中…
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">点击地图或拖动标记选择位置，地址会自动回填</p>
        </div>
      )}
    </div>
  );
}
