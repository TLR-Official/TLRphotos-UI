/**
 * @file useImagePixels - 核心像素数据获取 hook
 * @description
 *  通过与 CachedImage 相同的鉴权路径获取图片 Blob，加载到离屏 Canvas，
 *  降采样至最大 800px 长边后调用 getImageData 获取像素数据。
 *  所有下游工具（直方图/对比度/饱和度/锐度/色温/溢出）均基于此 hook 的输出。
 *
 * 性能：800px 降采样后约 64 万像素，getImageData + 基础分析 < 30ms，
 *       保证 < 200ms 的交互响应要求。
 */

import { useState, useEffect, useMemo } from 'react';
import { getCachedImage } from '../../../utils/imageCache';

/** 降采样最大长边 */
const MAX_SAMPLE_DIM = 800;

export interface UseImagePixelsResult {
  /** 降采样后的 ImageData，加载中或失败时为 null */
  imageData: ImageData | null;
  /** 原图宽度 */
  naturalWidth: number;
  /** 原图高度 */
  naturalHeight: number;
  /** 降采样后的宽度 */
  sampledWidth: number;
  /** 降采样后的高度 */
  sampledHeight: number;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 获取图片像素数据（降采样后的 ImageData）
 * @param src 图片 URL
 * @param authToken 管理员 token，与 CachedImage 一致
 */
export function useImagePixels(src: string, authToken?: string): UseImagePixelsResult {
  const [state, setState] = useState<UseImagePixelsResult>({
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    sampledWidth: 0,
    sampledHeight: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!src) {
      setState((s) => ({ ...s, loading: false, error: 'No image source' }));
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        // 与 CachedImage 相同的鉴权路径：携带 authToken 时通过 fetch + Authorization 头获取
        const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
        const blobUrl = await getCachedImage(src, headers);

        // 加载图片到 Image 对象
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Image load failed'));
          img.src = blobUrl;
        });

        if (cancelled) return;

        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;

        // 降采样：保持宽高比，长边不超过 MAX_SAMPLE_DIM
        const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(naturalWidth, naturalHeight));
        const sampledWidth = Math.round(naturalWidth * scale);
        const sampledHeight = Math.round(naturalHeight * scale);

        // 绘制到离屏 Canvas
        const canvas = document.createElement('canvas');
        canvas.width = sampledWidth;
        canvas.height = sampledHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
          throw new Error('Canvas 2D context unavailable');
        }

        ctx.drawImage(img, 0, 0, sampledWidth, sampledHeight);
        const imageData = ctx.getImageData(0, 0, sampledWidth, sampledHeight);

        if (cancelled) return;

        setState({
          imageData,
          naturalWidth,
          naturalHeight,
          sampledWidth,
          sampledHeight,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: (err as Error).message || '像素数据加载失败',
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, authToken]);

  return state;
}

/**
 * 计算三色直方图（RGB 256 bin）
 * 用 useMemo 缓存，imageData 不变时不重复计算
 */
export function useHistogram(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data } = imageData;
    const red = new Array(256).fill(0);
    const green = new Array(256).fill(0);
    const blue = new Array(256).fill(0);

    // 每 4 字节 = RGBA，步进 4 跳过 Alpha
    for (let i = 0; i < data.length; i += 4) {
      red[data[i]]++;
      green[data[i + 1]]++;
      blue[data[i + 2]]++;
    }

    const max = Math.max(
      Math.max(...red),
      Math.max(...green),
      Math.max(...blue)
    );

    return { red, green, blue, max };
  }, [imageData]);
}

/**
 * 计算对比度量化指标
 * - 标准差：亮度离散程度
 * - RMS 对比度：像素与均值差的平方和的均方根
 */
export function useContrast(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data } = imageData;
    const pixelCount = data.length / 4;
    let sum = 0;
    const luminances: number[] = new Array(pixelCount);

    // ITU-R BT.601 亮度公式
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      luminances[j] = lum;
      sum += lum;
    }

    const mean = sum / pixelCount;
    let sumSqDiff = 0;
    let min = 255;
    let max = 0;

    for (const lum of luminances) {
      sumSqDiff += (lum - mean) ** 2;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }

    const stdDev = Math.sqrt(sumSqDiff / pixelCount);
    const rms = Math.sqrt(sumSqDiff / pixelCount) / 255;

    return {
      stdDev,
      rms: rms * 100, // 转为百分比
      meanLuminance: mean,
      dynamicRange: max - min,
    };
  }, [imageData]);
}

/**
 * 计算饱和度分析
 * RGB → HSL 转换，统计平均饱和度与高/低饱和像素占比
 */
export function useSaturation(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data } = imageData;
    const pixelCount = data.length / 4;
    let sumSat = 0;
    let highCount = 0;
    let lowCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;

      // HSV 饱和度：delta / max（max=0 时为灰，sat=0）
      const sat = max === 0 ? 0 : delta / max;

      sumSat += sat;
      if (sat > 0.6) highCount++;
      if (sat < 0.1) lowCount++;
    }

    return {
      avgSaturation: sumSat / pixelCount,
      highSatRatio: highCount / pixelCount,
      lowSatRatio: lowCount / pixelCount,
    };
  }, [imageData]);
}

/**
 * 计算锐度评估（拉普拉斯方差）
 * 拉普拉斯卷积核：[0,1,0; 1,-4,1; 0,1,0]
 * 方差越大 → 边缘越丰富 → 图像越清晰
 */
export function useSharpness(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data, width, height } = imageData;
    const laplacianValues: number[] = [];

    // 跳过 1px 边框（卷积核 3x3 需要邻居）
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        // 计算亮度
        const lum = (cy: number, cx: number) => {
          const i = (cy * width + cx) * 4;
          return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        };

        // 拉普拉斯：上+下+左+右 - 4*中心
        const lap =
          lum(y - 1, x) +
          lum(y + 1, x) +
          lum(y, x - 1) +
          lum(y, x + 1) -
          4 * lum(y, x);

        laplacianValues.push(lap);
      }
    }

    // 计算方差
    const mean = laplacianValues.reduce((a, b) => a + b, 0) / laplacianValues.length;
    const variance =
      laplacianValues.reduce((a, b) => a + (b - mean) ** 2, 0) /
      laplacianValues.length;

    let rating: 'excellent' | 'good' | 'fair' | 'blurry';
    if (variance > 500) rating = 'excellent';
    else if (variance > 200) rating = 'good';
    else if (variance > 80) rating = 'fair';
    else rating = 'blurry';

    return { laplacianVariance: variance, rating };
  }, [imageData]);
}

/**
 * 计算色温分析（RGB 通道均值偏移）
 */
export function useColorTemp(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data } = imageData;
    const pixelCount = data.length / 4;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }

    const rMean = rSum / pixelCount;
    const gMean = gSum / pixelCount;
    const bMean = bSum / pixelCount;
    const ratio = rMean / Math.max(bMean, 1); // 避免除零

    let bias: 'warm' | 'cool' | 'neutral';
    if (ratio > 1.15) bias = 'warm';
    else if (ratio < 0.87) bias = 'cool';
    else bias = 'neutral';

    return { rMean, gMean, bMean, ratio, bias };
  }, [imageData]);
}

/**
 * 计算高光/暗部溢出
 * 高光：RGB 均值 > 245
 * 暗部：RGB 均值 < 10
 */
export function useClipping(imageData: ImageData | null) {
  return useMemo(() => {
    if (!imageData) return null;
    const { data, width } = imageData;
    const pixelCount = data.length / 4;
    let highlightCount = 0;
    let shadowCount = 0;
    const highlightPixels: Array<{ x: number; y: number }> = [];
    const shadowPixels: Array<{ x: number; y: number }> = [];

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const avg = (r + g + b) / 3;

      if (avg > 245) {
        highlightCount++;
        // 降采样坐标，用于 overlay 绘制
        const x = p % width;
        const y = Math.floor(p / width);
        highlightPixels.push({ x, y });
      } else if (avg < 10) {
        shadowCount++;
        const x = p % width;
        const y = Math.floor(p / width);
        shadowPixels.push({ x, y });
      }
    }

    return {
      highlightClipRatio: highlightCount / pixelCount,
      shadowClipRatio: shadowCount / pixelCount,
      highlightPixels,
      shadowPixels,
    };
  }, [imageData]);
}
