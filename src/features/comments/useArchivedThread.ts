/**
 * @file useArchivedThread.ts（V3.0.0）
 * @description 归档线程读取 Hook：IndexedDB 缓存 → 后端签名 URL → 云端直读 JSON →
 *              结构校验 → 回写缓存。签名 URL 失效（云端 403）时淘汰缓存并整体重取一次。
 */
import { useCallback, useState } from 'react';
import {
  fetchArchiveReadUrl,
  type ArchivedThreadPayloadDTO,
} from '../../api/comments';
import {
  getCachedArchivedThread,
  setCachedArchivedThread,
  evictArchivedThread,
} from './commentCache';

export type ArchivedThreadState = 'idle' | 'loading' | 'ready' | 'error';

export interface UseArchivedThreadResult {
  state: ArchivedThreadState;
  payload: ArchivedThreadPayloadDTO | null;
  error: string;
  /** 打开归档线程（优先缓存）；force=true 强制回源 */
  open: (rootId: string, force?: boolean) => Promise<void>;
  close: () => void;
}

/** 最小结构校验：防止云负载损坏/被篡改时渲染异常 */
function validatePayload(payload: unknown): payload is ArchivedThreadPayloadDTO {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Record<string, unknown>;
  return (
    data.formatVersion === 1 &&
    !!data.subject &&
    !!data.root &&
    Array.isArray(data.comments) &&
    data.comments.length > 0
  );
}

export function useArchivedThread(): UseArchivedThreadResult {
  const [state, setState] = useState<ArchivedThreadState>('idle');
  const [payload, setPayload] = useState<ArchivedThreadPayloadDTO | null>(null);
  const [error, setError] = useState('');

  const loadFromCloud = useCallback(async (rootId: string) => {
    const urlResult = await fetchArchiveReadUrl(rootId);
    if (!urlResult.success || !urlResult.data) {
      throw new Error(urlResult.message || '归档评论不存在');
    }

    const response = await fetch(urlResult.data.url);
    if (response.status === 403) {
      // 签名 URL 已失效：淘汰缓存，调用方应整体重取
      const err = new Error('ARCHIVE_URL_EXPIRED');
      err.name = 'ARCHIVE_URL_EXPIRED';
      throw err;
    }
    if (!response.ok) {
      throw new Error(`云端读取失败: ${response.status}`);
    }
    const data = await response.json();
    if (!validatePayload(data)) {
      throw new Error('归档内容校验失败');
    }
    await setCachedArchivedThread(rootId, data);
    return data;
  }, []);

  const open = useCallback(
    async (rootId: string, force = false) => {
      setState('loading');
      setError('');
      try {
        let data: ArchivedThreadPayloadDTO | null = null;
        if (!force) {
          data = await getCachedArchivedThread(rootId);
        }
        if (!data) {
          try {
            data = await loadFromCloud(rootId);
          } catch (cloudError) {
            // 签名失效/缓存陈旧：淘汰并重试一次
            if (cloudError instanceof Error && cloudError.name === 'ARCHIVE_URL_EXPIRED') {
              await evictArchivedThread(rootId);
              data = await loadFromCloud(rootId);
            } else {
              throw cloudError;
            }
          }
        }
        setPayload(data);
        setState('ready');
      } catch (err) {
        console.error('[useArchivedThread] 加载归档线程失败:', err);
        setError(err instanceof Error ? err.message : '加载失败');
        setState('error');
      }
    },
    [loadFromCloud]
  );

  const close = useCallback(() => {
    setState('idle');
    setPayload(null);
    setError('');
  }, []);

  return { state, payload, error, open, close };
}
