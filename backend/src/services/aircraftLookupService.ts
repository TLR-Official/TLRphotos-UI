/**
 * @file aircraftLookupService.ts
 * @description 飞机注册号 → 机型/所属航司 的查询服务。
 *  设计要点：
 *   1. provider 抽象：当前默认使用免费公开库 adsbdb（无需 Key），后续可无痛切换付费源；
 *   2. 本地缓存：命中即返回，避免重复请求上游被限流（TTL 90 天，仅缓存成功结果）；
 *   3. 全链路降级：上游超时/报错/查询不到时返回 null，调用方保持手填，绝不阻断上传。
 */

import { db } from '../db';

/** ICAO 机型代码 → 展示用型号名（仅收录常见机型，未收录时回退上游原始型号） */
const ICAO_TYPE_NAMES: Record<string, string> = {
  B738: '737-800',
  B739: '737-900',
  B38M: '737 MAX 8',
  B39M: '737 MAX 9',
  B744: '747-400',
  B748: '747-8',
  B752: '757-200',
  B763: '767-300',
  B772: '777-200',
  B773: '777-300',
  B77W: '777-300ER',
  B788: '787-8',
  B789: '787-9',
  B78X: '787-10',
  A319: 'A319',
  A320: 'A320',
  A321: 'A321',
  A20N: 'A320neo',
  A21N: 'A321neo',
  A332: 'A330-200',
  A333: 'A330-300',
  A343: 'A340-300',
  A359: 'A350-900',
  A35K: 'A350-1000',
  A388: 'A380-800',
  E190: 'E190',
  CRJ9: 'CRJ-900',
  AT76: 'ATR 72-600',
  DH8D: 'Dash 8 Q400',
  C919: 'C919',
  C909: 'ARJ21-700',
};

/** 缓存有效期：90 天（机型/注册人变更频率低，长缓存可显著降低上游压力） */
export const AIRCRAFT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** 上游请求超时（毫秒） */
const UPSTREAM_TIMEOUT_MS = 5000;
/** 网络类错误重试次数（并发上来时上游偶发连接重置，重试一次可显著提升命中率） */
const UPSTREAM_RETRY = 1;
/** 重试间隔（毫秒） */
const UPSTREAM_RETRY_DELAY_MS = 300;

/** 查询结果（字段均已归一化，可直接落库展示） */
export interface AircraftInfo {
  /** 归一化注册号（大写、无空格） */
  registration: string;
  /** 展示用机型标签，如 "Boeing 777-300ER" */
  aircraftType: string;
  /** ICAO 机型代码，如 B77W */
  icaoType: string;
  /** 制造商，如 Boeing */
  manufacturer: string;
  /** 注册持有人/运营航司，如 Air China */
  airline: string;
  /** 注册国家，如 China */
  country: string;
  /** 数据来源标识 */
  source: string;
}

/** 数据源接口：每个 provider 只需实现「注册号 → 结果」一步 */
export interface AircraftProvider {
  readonly name: string;
  lookup(registration: string): Promise<AircraftInfo | null>;
}

/**
 * 注册号归一化：去空格、转大写，仅保留字母/数字/连字符。
 * @returns 合法时返回归一化注册号，非法返回空串
 */
export function normalizeAircraftRegistration(input: unknown): string {
  if (typeof input !== 'string') return '';
  const value = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(value) ? value : '';
}

/** 把上游原始型号 + ICAO 代码翻译为展示用机型标签 */
export function buildAircraftTypeLabel(
  manufacturer: string | null | undefined,
  icaoType: string | null | undefined,
  rawType: string | null | undefined,
): string {
  const model = (icaoType && ICAO_TYPE_NAMES[icaoType]) || rawType || icaoType || '';
  if (!model) return '';
  return manufacturer ? `${manufacturer} ${model}` : model;
}

/** 免费公开源：adsbdb（无 Key，按注册号直查，附制造商/注册持有人/国家） */
const adsbdbProvider: AircraftProvider = {
  name: 'adsbdb',
  async lookup(registration) {
    const url = `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(registration)}`;
    let res: Awaited<ReturnType<typeof fetch>> | undefined;
    for (let attempt = 0; attempt <= UPSTREAM_RETRY; attempt += 1) {
      try {
        res = await fetch(url, {
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          headers: { Accept: 'application/json' },
        });
        break;
      } catch (error) {
        // 最后一次仍失败则抛出，由 lookupAircraft 统一捕获降级
        if (attempt === UPSTREAM_RETRY) throw error;
        await new Promise((resolve) => setTimeout(resolve, UPSTREAM_RETRY_DELAY_MS));
      }
    }
    if (!res || !res.ok) return null;
    const payload = (await res.json()) as { response?: unknown };
    // 未收录时上游返回 { response: "unknown aircraft" }，非对象即视为未命中
    const aircraft = (payload.response as { aircraft?: Record<string, unknown> })?.aircraft;
    if (!aircraft) return null;

    const manufacturer = String(aircraft.manufacturer ?? '').trim();
    const icaoType = String(aircraft.icao_type ?? '').trim();
    const rawType = String(aircraft.type ?? '').trim();
    return {
      registration,
      aircraftType: buildAircraftTypeLabel(manufacturer, icaoType, rawType),
      icaoType,
      manufacturer,
      airline: String(aircraft.registered_owner ?? '').trim(),
      country: String(aircraft.registered_owner_country_name ?? '').trim(),
      source: 'adsbdb',
    };
  },
};

/** provider 链：按顺序尝试，前一个未命中/异常时自动降级到下一个（便于日后接入付费源） */
const PROVIDERS: AircraftProvider[] = [adsbdbProvider];

/** 读取缓存中仍有效的记录 */
async function readCache(registration: string): Promise<AircraftInfo | null> {
  try {
    const row = await db.get<Record<string, string>>(
      'SELECT registration, aircraft_type, icao_type, manufacturer, airline, country, source, fetched_at FROM aircraft_cache WHERE registration = ?',
      registration,
    );
    if (!row) return null;
    const fetchedAt = Date.parse(row.fetched_at);
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt >= AIRCRAFT_CACHE_TTL_MS) return null;
    return {
      registration: row.registration,
      aircraftType: row.aircraft_type || '',
      icaoType: row.icao_type || '',
      manufacturer: row.manufacturer || '',
      airline: row.airline || '',
      country: row.country || '',
      source: row.source || '',
    };
  } catch {
    return null;
  }
}

/** 写入缓存（仅缓存成功结果，失败不入缓存以便下次重试） */
async function writeCache(info: AircraftInfo): Promise<void> {
  try {
    await db.run(
      `INSERT OR REPLACE INTO aircraft_cache
        (registration, aircraft_type, icao_type, manufacturer, airline, country, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      info.registration,
      info.aircraftType,
      info.icaoType,
      info.manufacturer,
      info.airline,
      info.country,
      info.source,
      new Date().toISOString(),
    );
  } catch {
    /* 缓存写入失败不影响主流程 */
  }
}

/**
 * 按注册号查询航空器信息：缓存优先，未命中依次尝试 provider 链。
 * @param input 用户输入的注册号（自动归一化）
 * @returns 命中返回结构化信息；未收录/上游异常/输入非法时返回 null
 */
export async function lookupAircraft(input: unknown): Promise<AircraftInfo | null> {
  const registration = normalizeAircraftRegistration(input);
  if (!registration) return null;

  const cached = await readCache(registration);
  if (cached) return cached;

  for (const provider of PROVIDERS) {
    try {
      const info = await provider.lookup(registration);
      if (info) {
        await writeCache(info);
        return info;
      }
    } catch (error) {
      // 单个源异常不阻断，继续尝试下一个源（当前仅一个免费源，异常时整体降级为 null）
      console.warn(`[AircraftLookup] ${provider.name} 查询失败:`, error instanceof Error ? error.message : error);
    }
  }
  return null;
}
