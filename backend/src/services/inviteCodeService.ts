/**
 * @file inviteCodeService.ts
 * @description 邀请码与用户称号服务（V4.7.0）。
 *  邀请码由管理后台发放，注册时校验并消费；有效邀请码在 users 上写入
 *  invite_code_id / user_title / title_granted_at，用户名称旁展示对应小标签。
 *  - 一码一人为默认，max_uses 可配置；
 *  - 注册消费在 BEGIN IMMEDIATE 事务内完成，避免并发超发；
 *  - 校验失败统一返回 INVITE_CODE_INVALID，由路由映射为 400。
 */
import crypto from 'crypto';
import { db } from '../db';

/** 邀请码实体（对应 invite_codes 表） */
export interface InviteCode {
  id: string;
  code: string;
  title: string;
  airline: string | null;
  max_uses: number;
  used_count: number;
  is_active: number;
  expires_at: string | null;
  remark: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 校验结果：ok 时返回邀请码实体，失败给出原因 */
export type InviteValidation =
  | { ok: true; invite: InviteCode }
  | { ok: false; reason: 'invalid' | 'inactive' | 'expired' | 'exhausted' };

/** 邀请码格式：4-64 位大写字母/数字/下划线/连字符 */
const INVITE_CODE_PATTERN = /^[A-Z0-9_-]{4,64}$/;
/** 生成邀请码时排除易混字符（I/O/0/1），降低手抄错误率 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 称号文案长度上限（小标签展示） */
const TITLE_MAX_LENGTH = 20;
/** 航司文案长度上限 */
const AIRLINE_MAX_LENGTH = 20;
/** 单码可用次数上限 */
const MAX_USES_LIMIT = 10000;

/**
 * 归一化邀请码：去空白、转大写，格式非法返回空串。
 */
export function normalizeInviteCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  const value = input.trim().toUpperCase().replace(/\s+/g, '');
  return INVITE_CODE_PATTERN.test(value) ? value : '';
}

/** 生成 10 位随机邀请码（大写字母 + 数字，排除易混字符） */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/** 按 code 查询邀请码（调用方负责先归一化） */
export async function findInviteCodeByCode(code: string): Promise<InviteCode | null> {
  const row = await db.get('SELECT * FROM invite_codes WHERE code = ?', code);
  return (row as InviteCode | undefined) ?? null;
}

/**
 * 判断邀请码当前是否可用：存在 → 启用 → 未过期 → 次数未用尽。
 */
export function checkInviteCodeUsable(invite: InviteCode, now = Date.now()): InviteValidation {
  if (!invite) return { ok: false, reason: 'invalid' };
  if (!invite.is_active) return { ok: false, reason: 'inactive' };
  if (invite.expires_at) {
    const expiresMs = Date.parse(invite.expires_at);
    // 无效日期视为不限期，与后台录入规则保持一致
    if (Number.isFinite(expiresMs) && expiresMs <= now) return { ok: false, reason: 'expired' };
  }
  if (invite.used_count >= invite.max_uses) return { ok: false, reason: 'exhausted' };
  return { ok: true, invite };
}

/**
 * 按用户输入校验邀请码。
 */
export async function validateInviteCode(input: unknown): Promise<InviteValidation> {
  const code = normalizeInviteCode(input);
  if (!code) return { ok: false, reason: 'invalid' };
  const invite = await findInviteCodeByCode(code);
  if (!invite) return { ok: false, reason: 'invalid' };
  return checkInviteCodeUsable(invite);
}

/**
 * 消费一次邀请码（注册事务内调用）。
 * WHERE 条件再次校验启用状态与剩余次数，返回是否成功扣减。
 */
export async function consumeInviteCode(inviteId: string): Promise<boolean> {
  const result = await db.run(
    `UPDATE invite_codes
        SET used_count = used_count + 1, updated_at = ?
      WHERE id = ? AND is_active = 1 AND used_count < max_uses`,
    new Date().toISOString(),
    inviteId,
  );
  return (result.changes ?? 0) > 0;
}

/** 管理端创建入参 */
export interface CreateInviteCodeInput {
  code?: unknown;
  title?: unknown;
  airline?: unknown;
  max_uses?: unknown;
  expires_at?: unknown;
  remark?: unknown;
}

/** 管理端更新入参（均为可选，仅更新传入字段） */
export interface UpdateInviteCodeInput {
  title?: unknown;
  airline?: unknown;
  max_uses?: unknown;
  expires_at?: unknown;
  remark?: unknown;
  is_active?: unknown;
}

/** 统一结果：失败携带可展示 message 与机器码 */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };

/**
 * 创建邀请码（管理后台）。
 * code 留空时自动生成；title 必填；max_uses 默认 1。
 */
export async function createInviteCode(
  input: CreateInviteCodeInput,
  createdBy: string,
): Promise<ServiceResult<InviteCode>> {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, message: '请填写对应称号' };
  if (title.length > TITLE_MAX_LENGTH) {
    return { ok: false, message: `称号最多 ${TITLE_MAX_LENGTH} 个字符` };
  }

  const airline = typeof input.airline === 'string' ? input.airline.trim() : '';
  if (airline.length > AIRLINE_MAX_LENGTH) {
    return { ok: false, message: `航司名称最多 ${AIRLINE_MAX_LENGTH} 个字符` };
  }

  let code = '';
  if (typeof input.code === 'string' && input.code.trim()) {
    code = normalizeInviteCode(input.code);
    if (!code) return { ok: false, message: '邀请码格式不正确（4-64 位字母/数字/下划线/连字符）' };
  } else {
    code = generateInviteCode();
  }

  const maxUsesRaw = input.max_uses === undefined || input.max_uses === null || input.max_uses === ''
    ? 1
    : Number(input.max_uses);
  if (!Number.isInteger(maxUsesRaw) || maxUsesRaw < 1 || maxUsesRaw > MAX_USES_LIMIT) {
    return { ok: false, message: `可用次数须为 1-${MAX_USES_LIMIT} 的整数` };
  }

  let expiresAt: string | null = null;
  if (typeof input.expires_at === 'string' && input.expires_at.trim()) {
    const ms = Date.parse(input.expires_at);
    if (!Number.isFinite(ms)) return { ok: false, message: '到期时间格式不正确' };
    expiresAt = new Date(ms).toISOString();
  }

  const remark = typeof input.remark === 'string' ? input.remark.trim().slice(0, 200) : '';

  const existing = await findInviteCodeByCode(code);
  if (existing) return { ok: false, message: '该邀请码已存在', code: 'INVITE_CODE_DUPLICATE' };

  const now = new Date().toISOString();
  const id = `inv_${Date.now()}_${crypto.randomInt(1000, 9999)}`;
  await db.run(
    `INSERT INTO invite_codes
      (id, code, title, airline, max_uses, used_count, is_active, expires_at, remark, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    id, code, title, airline || null, maxUsesRaw, expiresAt, remark || null, createdBy, now, now,
  );

  const created = await db.get('SELECT * FROM invite_codes WHERE id = ?', id);
  return { ok: true, data: created as InviteCode };
}

/**
 * 管理端分页列表：keyword 同时匹配 code / title / airline。
 */
export async function listInviteCodes(options: {
  page: number;
  pageSize: number;
  keyword?: string;
}): Promise<{ items: InviteCode[]; total: number }> {
  const { page, pageSize } = options;
  const keyword = (options.keyword || '').trim();
  const params: Array<string | number> = [];
  let where = '';
  if (keyword) {
    where = 'WHERE code LIKE ? OR title LIKE ? OR airline LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const totalRow = await db.get(`SELECT COUNT(*) AS c FROM invite_codes ${where}`, params);
  const rows = await db.all(
    `SELECT * FROM invite_codes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { items: (rows as InviteCode[]) ?? [], total: (totalRow as { c: number } | undefined)?.c ?? 0 };
}

/**
 * 管理端更新邀请码：max_uses 不得低于已使用次数。
 */
export async function updateInviteCode(
  id: string,
  input: UpdateInviteCodeInput,
): Promise<ServiceResult<InviteCode>> {
  const existing = (await db.get('SELECT * FROM invite_codes WHERE id = ?', id)) as InviteCode | undefined;
  if (!existing) return { ok: false, message: '邀请码不存在' };

  const updates: string[] = [];
  const params: Array<string | number | null> = [];

  if (input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) return { ok: false, message: '请填写对应称号' };
    if (title.length > TITLE_MAX_LENGTH) return { ok: false, message: `称号最多 ${TITLE_MAX_LENGTH} 个字符` };
    updates.push('title = ?');
    params.push(title);
  }

  if (input.airline !== undefined) {
    const airline = typeof input.airline === 'string' ? input.airline.trim() : '';
    if (airline.length > AIRLINE_MAX_LENGTH) {
      return { ok: false, message: `航司名称最多 ${AIRLINE_MAX_LENGTH} 个字符` };
    }
    updates.push('airline = ?');
    params.push(airline || null);
  }

  if (input.max_uses !== undefined) {
    const maxUses = Number(input.max_uses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES_LIMIT) {
      return { ok: false, message: `可用次数须为 1-${MAX_USES_LIMIT} 的整数` };
    }
    if (maxUses < existing.used_count) {
      return { ok: false, message: `可用次数不能小于已使用次数（${existing.used_count}）` };
    }
    updates.push('max_uses = ?');
    params.push(maxUses);
  }

  if (input.expires_at !== undefined) {
    if (input.expires_at === null || input.expires_at === '') {
      updates.push('expires_at = ?');
      params.push(null);
    } else if (typeof input.expires_at === 'string') {
      const ms = Date.parse(input.expires_at);
      if (!Number.isFinite(ms)) return { ok: false, message: '到期时间格式不正确' };
      updates.push('expires_at = ?');
      params.push(new Date(ms).toISOString());
    } else {
      return { ok: false, message: '到期时间格式不正确' };
    }
  }

  if (input.remark !== undefined) {
    const remark = typeof input.remark === 'string' ? input.remark.trim().slice(0, 200) : '';
    updates.push('remark = ?');
    params.push(remark || null);
  }

  if (input.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(input.is_active === true || input.is_active === 1 || input.is_active === '1' ? 1 : 0);
  }

  if (updates.length === 0) return { ok: false, message: '没有需要更新的字段' };

  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  await db.run(`UPDATE invite_codes SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);

  const updated = (await db.get('SELECT * FROM invite_codes WHERE id = ?', id)) as InviteCode;
  return { ok: true, data: updated };
}

/**
 * 管理端删除邀请码：仅允许删除尚未被使用的码（已使用的请改用停用，保留审计链路）。
 */
export async function deleteInviteCode(id: string): Promise<ServiceResult<InviteCode>> {
  const existing = (await db.get('SELECT * FROM invite_codes WHERE id = ?', id)) as InviteCode | undefined;
  if (!existing) return { ok: false, message: '邀请码不存在' };
  if (existing.used_count > 0) {
    return { ok: false, message: '该邀请码已被使用，无法删除，请改为停用', code: 'INVITE_CODE_IN_USE' };
  }
  await db.run('DELETE FROM invite_codes WHERE id = ?', id);
  return { ok: true, data: existing };
}
