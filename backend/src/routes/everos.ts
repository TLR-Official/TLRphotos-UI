/**
 * @file everos.ts
 * @description EverOS 记忆层路由（V1.9.0 新增）。
 *              为 AI Agent 提供持久化记忆的写入与检索接口：
 *                POST /api/everos/memory  — 写入会话轮次（云端异步抽取为记忆）
 *                POST /api/everos/search  — 检索当前用户自己的记忆
 *              两个接口均需登录，记忆按用户隔离，用户只能写入/检索本人的记忆。
 */
import express from 'express';
import { loadAuthUser } from '../services/authService';
import {
  addTurn,
  searchMemory,
  isEverosConfigured,
  type MemoryRole,
  type SearchMethod,
} from '../services/everosService';

const router = express.Router();

const VALID_ROLES: MemoryRole[] = ['user', 'assistant', 'tool'];
const VALID_METHODS: SearchMethod[] = ['keyword', 'vector', 'hybrid', 'agentic'];

/**
 * POST /api/everos/memory
 * Body: { content: string, session_id?: string, role?: 'user'|'assistant'|'tool', async_mode?: boolean }
 */
router.post('/memory', async (req, res) => {
  if (!isEverosConfigured()) {
    return res
      .status(503)
      .json({ success: false, message: '记忆服务未配置：缺少 EVEROS_API_KEY' });
  }

  const { user, error } = await loadAuthUser(req);
  if (error) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (!user) {
    return res.status(401).json({ success: false, message: '请先登录后再写入记忆' });
  }

  const { content, session_id, role, async_mode } = req.body || {};

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'content 为必填字符串' });
  }
  if (content.length > 10000) {
    return res.status(400).json({ success: false, message: '单条记忆内容不能超过 10000 字符' });
  }
  if (session_id !== undefined && (typeof session_id !== 'string' || session_id.length > 128)) {
    return res.status(400).json({ success: false, message: 'session_id 需为不超过 128 字符的字符串' });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: `role 仅支持：${VALID_ROLES.join(' / ')}` });
  }

  try {
    const data = await addTurn({
      sessionId: session_id,
      userId: user.id,
      role,
      content: content.trim(),
      asyncMode: typeof async_mode === 'boolean' ? async_mode : undefined,
    });
    return res.json({ success: true, data });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return res.status(e.status || 500).json({ success: false, message: e.message || '记忆写入失败' });
  }
});

/**
 * POST /api/everos/search
 * Body: { query: string, method?: SearchMethod, top_k?: number, include_profile?: boolean }
 */
router.post('/search', async (req, res) => {
  if (!isEverosConfigured()) {
    return res
      .status(503)
      .json({ success: false, message: '记忆服务未配置：缺少 EVEROS_API_KEY' });
  }

  const { user, error } = await loadAuthUser(req);
  if (error) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  if (!user) {
    return res.status(401).json({ success: false, message: '请先登录后再检索记忆' });
  }

  const { query, method, top_k, include_profile } = req.body || {};

  if (typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ success: false, message: 'query 为必填字符串' });
  }
  if (method !== undefined && !VALID_METHODS.includes(method)) {
    return res.status(400).json({ success: false, message: `method 仅支持：${VALID_METHODS.join(' / ')}` });
  }
  if (top_k !== undefined && (!Number.isInteger(top_k) || top_k < 1 || top_k > 100)) {
    return res.status(400).json({ success: false, message: 'top_k 需为 1–100 的整数' });
  }
  if (include_profile !== undefined && typeof include_profile !== 'boolean') {
    return res.status(400).json({ success: false, message: 'include_profile 需为布尔值' });
  }

  try {
    const result = await searchMemory({
      query: query.trim(),
      userId: user.id,
      method,
      topK: top_k,
      includeProfile: include_profile,
    });
    return res.json({
      success: true,
      data: {
        episodes: result.episodes,
        profiles: result.profiles,
        unprocessed_messages: result.unprocessedMessages,
      },
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return res.status(e.status || 500).json({ success: false, message: e.message || '记忆检索失败' });
  }
});

export default router;
