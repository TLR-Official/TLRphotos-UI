/**
 * @file AircraftInfoCard.tsx
 * @description 飞机注册号自动识别结果卡片（V4.6.0）。
 *  输入合法注册号后 500ms 防抖查询机型/所属航司，桌面与移动上传页共用。
 *  查询失败（未收录/网络异常）只提示可手动填写，不阻断上传流程。
 */
import { useEffect, useRef, useState } from 'react';
import { lookupAircraft } from '../api/aircraft';
import type { AircraftLookupResult } from '../api/aircraft';

/** 注册号格式（与后端 REGISTRATION_PATTERN 一致） */
const REGISTRATION_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
/** 输入防抖时长：避免逐字符触发上游查询 */
const DEBOUNCE_MS = 500;

interface AircraftInfoCardProps {
  /** 注册号原始输入值 */
  registration: string;
  /** 是否允许查询（非航空分区 / 未登录时传 false） */
  enabled?: boolean;
  className?: string;
}

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'hit'; info: AircraftLookupResult }
  | { status: 'miss' };

export function AircraftInfoCard({ registration, enabled = true, className = '' }: AircraftInfoCardProps) {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  // 请求序号：输入变化后丢弃过期响应，避免旧结果覆盖新结果
  const seqRef = useRef(0);

  const normalized = registration.trim().toUpperCase();
  const isValid = REGISTRATION_PATTERN.test(normalized);

  useEffect(() => {
    if (!enabled || !isValid) {
      seqRef.current += 1;
      setState({ status: 'idle' });
      return;
    }

    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      setState({ status: 'loading' });
      const res = await lookupAircraft(normalized);
      if (seqRef.current !== seq) return;
      if (res.success && res.data) {
        setState({ status: 'hit', info: res.data });
      } else {
        setState({ status: 'miss' });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [normalized, isValid, enabled]);

  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return <p className={`mt-1 text-xs text-gray-500 ${className}`}>正在识别机型与航司…</p>;
  }

  if (state.status === 'miss') {
    return (
      <p className={`mt-1 text-xs text-gray-500 ${className}`}>
        未收录该注册号，可继续手动填写；不影响提交。
      </p>
    );
  }

  const { info } = state;
  return (
    <div className={`mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs ${className}`}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-900">
        <span>机型：{info.aircraft_type || '未识别'}</span>
        <span>航司：{info.airline || '未识别'}</span>
        {info.country && <span>注册地：{info.country}</span>}
      </div>
      <p className="mt-1 text-gray-400">信息来自第三方航空器数据库（{info.source || 'adsbdb'}），仅供参考</p>
    </div>
  );
}
