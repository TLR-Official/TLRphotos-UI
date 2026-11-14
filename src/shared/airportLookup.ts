/**
 * @file 机场识别（V4.13）
 * @description
 *  依据 docs/prd-v4.11-upload-tag-optimization.md 3.6：
 *  输入 IATA（3 位）或 ICAO（4 位）代码，离线匹配机场全称，供「拍摄地点」回填。
 *  数据源为内置 OurAirports 子集（airportData.ts），不请求后端；
 *  数据文件通过动态 import 加载，未使用机场识别时不进入首屏主包。
 */

import type { AirportTuple } from './airportData';

/** 机场识别结果 */
export interface AirportMatch {
  /** IATA 三字码（可能为空） */
  iata: string;
  /** ICAO 四字码 */
  icao: string;
  /** 机场名称（优先中文，缺失时英文） */
  name: string;
  /** 所在城市（可能为空） */
  city: string;
  /** 国家/地区代码（ISO 3166-1 alpha-2） */
  country: string;
}

/** IATA 三字码（全大写字母） */
const IATA_PATTERN = /^[A-Z]{3}$/;
/** ICAO 四字码（全大写字母） */
const ICAO_PATTERN = /^[A-Z]{4}$/;

/** 统一代码大小写并去除首尾空白 */
export function normalizeAirportCode(input: string): string {
  return input.trim().toUpperCase();
}

/** 是否为可查询的完整机场代码（3 位 IATA 或 4 位 ICAO） */
export function isAirportCode(input: string): boolean {
  const code = normalizeAirportCode(input);
  return IATA_PATTERN.test(code) || ICAO_PATTERN.test(code);
}

/** 索引缓存：首次查询时动态加载数据并建立 IATA/ICAO 双键索引 */
let airportIndexPromise: Promise<Map<string, AirportMatch>> | null = null;

/** 由元组数据构建双键索引（IATA 与 ICAO 均可命中） */
function buildIndex(records: readonly AirportTuple[]): Map<string, AirportMatch> {
  const index = new Map<string, AirportMatch>();
  for (const [iata, icao, name, city, country] of records) {
    const match: AirportMatch = { iata, icao, name, city, country };
    if (iata) index.set(iata, match);
    if (icao) index.set(icao, match);
  }
  return index;
}

/**
 * 按 IATA / ICAO 代码查询机场
 * @param input 用户输入的机场代码（大小写不敏感）
 * @returns 命中返回机场信息，非完整代码或未收录返回 null
 */
export async function lookupAirport(input: string): Promise<AirportMatch | null> {
  const code = normalizeAirportCode(input);
  if (!IATA_PATTERN.test(code) && !ICAO_PATTERN.test(code)) return null;
  if (!airportIndexPromise) {
    airportIndexPromise = import('./airportData').then((module) => buildIndex(module.AIRPORTS));
  }
  const index = await airportIndexPromise;
  return index.get(code) ?? null;
}

/**
 * 生成回填「拍摄地点」的展示文案
 * @example formatAirportLocation({ iata: 'SZX', name: '深圳宝安国际机场' }) => '深圳宝安国际机场（SZX）'
 */
export function formatAirportLocation(match: AirportMatch): string {
  const code = match.iata || match.icao;
  return code ? `${match.name}（${code}）` : match.name;
}
