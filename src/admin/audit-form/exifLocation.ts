/**
 * @file exifLocation - 从原图 EXIF 读取 GPS 坐标（V4.10.0）
 * @description
 *  审核端「拍摄地点」自动填充的兜底能力。
 *  必须读取原图：预览图/水印图经 sharp 重编码后 EXIF 已被剥离。
 *  失败（无 GPS、网络异常、主动取消）统一返回 null，不阻断审核流程。
 */
import exifr from 'exifr';

/** EXIF 解析出的坐标 */
export interface ExifLocation {
  latitude: number;
  longitude: number;
}

/**
 * 读取图片 EXIF 中的 GPS 坐标。
 * @param url 原图地址（管理端代理 URL）
 * @param token 管理员 JWT（未审核照片需要鉴权）
 * @param signal 取消信号
 * @returns 坐标或 null
 */
export async function readExifLocation(
  url: string,
  token: string | undefined,
  signal?: AbortSignal
): Promise<ExifLocation | null> {
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    const data = await exifr.parse(blob, { gps: true });
    if (!data) return null;

    // exifr 的 gps 段同时提供便捷字段 latitude/longitude 与原始 GPSLatitude/GPSLongitude
    const latitude = data.latitude ?? data.GPSLatitude;
    const longitude = data.longitude ?? data.GPSLongitude;

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return null;
    }

    return { latitude, longitude };
  } catch {
    return null;
  }
}

/**
 * 将坐标格式化为「纬度, 经度」文本（6 位小数，与高德逆地理编码精度一致）。
 */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
