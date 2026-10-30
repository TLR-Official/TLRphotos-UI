/**
 * @file 航空器查询 API
 * @description
 *  封装「飞机注册号 → 机型/所属航司」查询接口（V4.6.0）。
 *  仅用于上传表单实时回显；落库由上传接口按 registration_number 自动完成。
 */

import { request } from './client';
import type { ApiResponse } from './client';

/** 航空器查询结果 */
export interface AircraftLookupResult {
  registration: string;    // 归一化注册号（大写）
  aircraft_type: string;   // 展示用机型，如 "Boeing 777-300ER"
  icao_type: string;       // ICAO 机型代码，如 "B77W"
  manufacturer: string;    // 制造商，如 "Boeing"
  airline: string;         // 所属航司 / 注册持有人，如 "Air China"
  country: string;         // 注册国家，如 "China"
  source: string;          // 数据来源标识，如 "adsbdb"
}

/**
 * 按注册号查询机型与航司（需登录）
 * @param registration - 飞机注册号（大小写均可，服务端统一归一化）
 * @returns ApiResponse；未收录时 success=false 且 code='AIRCRAFT_NOT_FOUND'
 */
export async function lookupAircraft(registration: string): Promise<ApiResponse<AircraftLookupResult>> {
  return request<AircraftLookupResult>(`/aircraft/lookup?reg=${encodeURIComponent(registration)}`);
}
