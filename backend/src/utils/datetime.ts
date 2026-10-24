/**
 * @file datetime.ts
 * @description 后端本地时间格式化的统一实现。
 *
 * 处罚相关的用户可见文案（上传/下载禁令提示、处罚通知正文）需要把解禁时间
 * 以「YYYY-MM-DD HH:mm」的本地时区短格式展示。该拼装逻辑原先在 photos 与
 * admin 两个路由各写一份，此处收敛为唯一实现。
 * 说明：不引入时区库，直接使用服务器本地时区，与原实现一致。
 */

/**
 * 格式化为本地时区 `YYYY-MM-DD HH:mm`。
 * @param input - Date 实例、时间戳或可被 Date 解析的字符串
 * @returns 形如 `2026-10-24 18:30` 的字符串；非法输入沿用原生 Date 的 NaN 表现
 */
export function formatLocalDateTime(input: Date | string | number): string {
  const d = input instanceof Date ? input : new Date(input);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
