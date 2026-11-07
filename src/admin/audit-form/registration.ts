/**
 * @file registration - 审核端注册号规则（V4.10.0）
 * @description 与后端 PATCH /api/admin/photos/:id 的校验保持一致，
 *              单独成型以便表单组件与页面共用，避免组件文件混合导出引发 Fast Refresh 警告。
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
