/**
 * @file 注册号规则（V4.11）
 * @description
 *  飞机注册号在前端上传页与审核端共用同一套规则：
 *  - 空串表示未填写（审核端允许）；
 *  - N/A 表示确认无注册号（上传页与审核端均允许）；
 *  - 其余须为 2-20 位大写字母/数字/连字符，且首位非连字符。
 */

/** 「无注册号」固定值（与后端归一值一致） */
export const REGISTRATION_NA = 'N/A';

/** 合法注册号格式：2-20 位字母/数字/连字符，首位非连字符 */
export const REGISTRATION_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

/**
 * 判断注册号草稿是否可提交。
 * 空串表示未填写，N/A 表示确认无注册号，二者均合法。
 */
export function isRegistrationDraftValid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === REGISTRATION_NA) return true;
  return REGISTRATION_PATTERN.test(trimmed);
}

/** 上传页需要实际填写：航空分区必须为合法注册号或 N/A，不允许留空（自动转大写后校验） */
export function isRegistrationFilledValid(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  return trimmed !== '' && isRegistrationDraftValid(trimmed);
}

/** 输入归一化：去空格并转大写 */
export function normalizeRegistrationInput(value: string): string {
  return value.trim().toUpperCase();
}
