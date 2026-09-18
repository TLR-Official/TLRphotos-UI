/**
 * @file everosService.ts
 * @description EverOS 记忆层服务（V1.9.0 新增）。
 *              EverOS 是面向 AI Agent 的"记忆操作系统"：会话消息写入后由云端
 *              异步抽取为 episode（情节记忆）与 atomic_facts（原子事实），
 *              自动去重、消解矛盾，并在生成前通过检索召回相关上下文。
 *
 *              本模块基于 EverOS v2 HTTP API（官方明确 HTTP-first、任何语言通用），
 *              封装两个核心能力：addMessages（写入会话轮次）、searchMemory（检索记忆）。
 *              凭证通过环境变量 EVEROS_API_KEY 注入，禁止硬编码。
 *
 *              文档：https://docs.evermind.ai/llms-full.txt
 */

// EverOS 云端 API 基址（自托管时可用 EVEROS_BASE_URL 覆盖，默认 http://127.0.0.1:8000）
const EVEROS_BASE_URL = process.env.EVEROS_BASE_URL || 'https://api.evermind.ai';
// project_id 用于记忆空间隔离：查询永不跨空间。默认使用 tlrphotos，与同账号其他应用隔离
const EVEROS_PROJECT_ID = process.env.EVEROS_PROJECT_ID || 'tlrphotos';
// 助手侧固定 sender_id：多轮对话中区分用户与助手发言
const ASSISTANT_SENDER_ID = 'tlrphotos_assistant';
// HTTP 请求超时（毫秒）：EverOS 检索 hybrid 典型 200–600ms
const REQUEST_TIMEOUT_MS = 15000;

/**
 * 读取 API Key：动态读取 process.env，便于测试环境注入/移除，
 * 也避免模块加载早于 dotenv.config() 时读到空值。
 */
function getApiKey(): string {
  return process.env.EVEROS_API_KEY || '';
}

/** 记忆消息角色（对齐 EverOS v2 契约） */
export type MemoryRole = 'user' | 'assistant' | 'tool';

/** 检索方式：keyword（<100ms）/ vector / hybrid（默认，RRF 融合）/ agentic */
export type SearchMethod = 'keyword' | 'vector' | 'hybrid' | 'agentic';

export interface MemoryMessage {
  sender_id: string;
  role: MemoryRole;
  timestamp: number;
  content: string;
}

export interface AddTurnParams {
  /** 会话标识；缺省按用户派生默认会话 */
  sessionId?: string;
  /** 记忆归属用户 ID（JWT 解析得到），同时作为用户轮次的 sender_id */
  userId: string;
  /** 发言角色，默认 user */
  role?: MemoryRole;
  /** 消息文本内容 */
  content: string;
  /** 是否同步写入：默认 true 走云端异步（202 queued，抽取在后台进行） */
  asyncMode?: boolean;
}

export interface SearchMemoryParams {
  query: string;
  userId: string;
  method?: SearchMethod;
  topK?: number;
  includeProfile?: boolean;
}

export interface MemorySearchResult {
  /** 情节记忆（已巩固的叙事片段，含 atomic_facts） */
  episodes: Array<Record<string, unknown>>;
  /** 用户画像条目（显式信息 + 隐式特征） */
  profiles: Array<Record<string, unknown>>;
  /** 当前会话尚未完成抽取的原始消息尾部 */
  unprocessedMessages: Array<Record<string, unknown>>;
}

/**
 * EverOS 是否已配置 API Key。
 * 未配置时路由层应返回明确错误，而不是发起必然 401 的请求。
 */
export function isEverosConfigured(): boolean {
  return getApiKey().length > 0;
}

/**
 * 统一的 EverOS v2 HTTP 调用。
 * 处理 Bearer 鉴权、JSON 信封解析、超时中止与错误归一化。
 *
 * @param path 以 / 开头的 v2 接口路径
 * @param body 请求体
 * @returns 信封内的 data 字段
 * @throws 网络异常、超时或服务端返回非 2xx 时抛出带错误码的 Error
 */
async function everosFetch<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${EVEROS_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // EverOS 错误体形如 {detail/code/message}，提取最具信息量的一项
      const detail =
        payload?.detail || payload?.message || payload?.code || `HTTP ${response.status}`;
      const error = new Error(`EverOS 请求失败：${detail}`) as Error & {
        status?: number;
        everosDetail?: unknown;
      };
      error.status = response.status;
      error.everosDetail = payload;
      throw error;
    }

    return (payload?.data ?? null) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`EverOS 请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 写入单个会话轮次到 EverOS。
 * 云端默认异步抽取：返回 202 queued，无需后续轮询；
 * 抽取完成后该轮次会自动成为可检索的 episode。
 *
 * @returns 云端返回的 data（异步时为 {message_count, status:'queued'}）
 */
export async function addTurn(params: AddTurnParams): Promise<Record<string, unknown>> {
  const { userId, role = 'user', content, asyncMode = true } = params;
  const sessionId = params.sessionId || `session_${userId}`;

  const message: MemoryMessage = {
    sender_id: role === 'user' ? userId : ASSISTANT_SENDER_ID,
    role,
    // v2 契约要求 unix 毫秒；秒级会被拒绝而非自动换算
    timestamp: Date.now(),
    content,
  };

  return everosFetch('/api/v2/memory/add', {
    session_id: sessionId,
    project_id: EVEROS_PROJECT_ID,
    async_mode: asyncMode,
    messages: [message],
  });
}

/**
 * 检索指定用户的记忆。
 * 生成回答前调用：以 hybrid（关键词 + 向量 RRF 融合）召回情节记忆，
 * 用户只能检索自己的记忆空间。
 */
export async function searchMemory(params: SearchMemoryParams): Promise<MemorySearchResult> {
  const { query, userId, method = 'hybrid', topK = 5, includeProfile = false } = params;

  const data = await everosFetch<{
    episodes?: Array<Record<string, unknown>>;
    profiles?: Array<Record<string, unknown>>;
    unprocessed_messages?: Array<Record<string, unknown>>;
  }>('/api/v2/memory/search', {
    query,
    user_id: userId, // search 要求 user_id / agent_id 恰好一个
    project_id: EVEROS_PROJECT_ID,
    method,
    top_k: topK,
    include_profile: includeProfile,
  });

  return {
    episodes: data?.episodes ?? [],
    profiles: data?.profiles ?? [],
    unprocessedMessages: data?.unprocessed_messages ?? [],
  };
}
