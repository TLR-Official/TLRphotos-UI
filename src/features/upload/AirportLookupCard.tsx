/**
 * @file AirportLookupCard.tsx
 * @description
 *  航空分区「拍摄地点」机场识别卡片（V4.13，PRD 3.6）。
 *  输入 IATA / ICAO 代码后离线匹配机场全称，确认后回填拍摄地点；
 *  桌面端与移动端上传页共用，移动端确认按钮热区 ≥44px。
 */

import { useEffect, useRef, useState } from 'react';
import {
  formatAirportLocation,
  isAirportCode,
  lookupAirport,
  normalizeAirportCode,
} from '../../shared/airportLookup';
import type { AirportMatch } from '../../shared/airportLookup';

/** 输入防抖时长：避免逐字符触发查表 */
const DEBOUNCE_MS = 200;

interface AirportLookupCardProps {
  /** 拍摄地点当前输入值 */
  value: string;
  /** 是否启用识别（上传中禁用） */
  enabled?: boolean;
  /** 点击「确认」后回调，参数为回填文案（如「深圳宝安国际机场（SZX）」） */
  onConfirm: (location: string) => void;
  className?: string;
}

type LookupState =
  | { status: 'idle' }
  | { status: 'hit'; match: AirportMatch }
  | { status: 'miss' };

export function AirportLookupCard({
  value,
  enabled = true,
  onConfirm,
  className = '',
}: AirportLookupCardProps) {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  // 请求序号：输入变化后丢弃过期结果
  const seqRef = useRef(0);

  const code = normalizeAirportCode(value);
  const isCode = isAirportCode(code);

  useEffect(() => {
    if (!enabled || !isCode) {
      seqRef.current += 1;
      setState({ status: 'idle' });
      return;
    }

    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      const match = await lookupAirport(code);
      if (seqRef.current !== seq) return;
      setState(match ? { status: 'hit', match } : { status: 'miss' });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [code, isCode, enabled]);

  if (state.status === 'idle') return null;

  if (state.status === 'miss') {
    return (
      <p className={`mt-1 text-xs text-gray-500 ${className}`}>
        未收录该机场代码，可继续手动填写拍摄地点。
      </p>
    );
  }

  const { match } = state;
  const codeLabel = match.iata && match.icao ? `${match.iata} / ${match.icao}` : match.iata || match.icao;
  return (
    <div
      className={`mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 ${className}`}
    >
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{codeLabel}</p>
        <p className="text-sm text-gray-900">{match.name}</p>
        {(match.city || match.country) && (
          <p className="text-xs text-gray-400">
            {[match.city, match.country].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onConfirm(formatAirportLocation(match))}
        disabled={!enabled}
        className="min-h-[44px] rounded-lg border border-blue-700 px-3 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[32px]"
      >
        确认填入
      </button>
    </div>
  );
}
