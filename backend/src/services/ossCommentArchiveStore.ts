/**
 * @file ossCommentArchiveStore.ts
 * @description V3.0.0 归档存储的 OSS 实现（ICommentArchiveStore）。
 *              复用 ossService 现有凭证与 bucket，对象 key 统一走
 *              comments-archive/ 前缀；序列化/反序列化仅负责 JSON 编解码，
 *              领域校验在 commentArchiveService 中完成。
 */
import {
  uploadBufferToOSS,
  getObjectBuffer,
  deleteFromOSS,
  objectExists,
} from './ossService';
import {
  archiveKeyOf,
  type ArchivedThreadPayload,
  type ICommentArchiveStore,
} from './commentArchiveStore';

/** OSS 归档存储单例（凭证由 ossService 启动时从环境变量读取） */
export const ossCommentArchiveStore: ICommentArchiveStore = {
  async put(rootId, payload) {
    const key = archiveKeyOf(rootId);
    const buffer = Buffer.from(JSON.stringify(payload), 'utf-8');
    await uploadBufferToOSS(buffer, key, 'application/json; charset=utf-8');
    return { size: buffer.byteLength };
  },

  async get(rootId) {
    const buffer = await getObjectBuffer(archiveKeyOf(rootId));
    if (!buffer) return null;
    return JSON.parse(buffer.toString('utf-8')) as ArchivedThreadPayload;
  },

  async delete(rootId) {
    await deleteFromOSS(archiveKeyOf(rootId));
  },

  async exists(rootId) {
    return objectExists(archiveKeyOf(rootId));
  },
};
