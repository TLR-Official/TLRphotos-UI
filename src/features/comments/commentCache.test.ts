/**
 * @file commentCache.test.ts
 * @description TR-6.2 IndexedDB 归档缓存测试：命中、TTL 过期淘汰重取、主动 evict。
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_CACHE_TTL_MS,
  getCachedArchivedThread,
  setCachedArchivedThread,
  evictArchivedThread,
} from './commentCache';
import type { ArchivedThreadPayloadDTO } from '../../api/comments';

const makePayload = (id: string): ArchivedThreadPayloadDTO => ({
  formatVersion: 1,
  subject: { type: 'photo', id: 's1' },
  root: { id, createdAt: new Date().toISOString() },
  comments: [
    {
      id,
      subject_type: 'photo',
      subject_id: 's1',
      root_id: id,
      parent_id: null,
      depth: 1,
      user_id: 'u1',
      author: 'alice',
      reply_to_user_id: null,
      reply_to_user_name: null,
      content: 'hello',
      like_count: 0,
      created_at: new Date().toISOString(),
    },
  ],
  likes: [],
  archivedAt: new Date().toISOString(),
});

describe('commentCache', () => {
  it('未命中返回 null', async () => {
    expect(await getCachedArchivedThread('nonexistent')).toBeNull();
  });

  it('写入后可读取', async () => {
    await setCachedArchivedThread('r1', makePayload('r1'));
    const hit = await getCachedArchivedThread('r1');
    expect(hit).not.toBeNull();
    expect(hit?.root.id).toBe('r1');
  });

  it('超过 TTL 视为过期并淘汰，返回 null', async () => {
    await setCachedArchivedThread('r2', makePayload('r2'));
    const expired = await getCachedArchivedThread(
      'r2',
      Date.now() + ARCHIVE_CACHE_TTL_MS + 1
    );
    expect(expired).toBeNull();
    // 已被淘汰
    expect(await getCachedArchivedThread('r2')).toBeNull();
  });

  it('evict 主动淘汰后不可读', async () => {
    await setCachedArchivedThread('r3', makePayload('r3'));
    await evictArchivedThread('r3');
    expect(await getCachedArchivedThread('r3')).toBeNull();
  });
});
