/**
 * @file 超级管理员创建脚本
 * @description 独立可执行脚本，用于在数据库中初始化超级管理员账号。
 *              用法：`ts-node createSuperAdmin.ts [username] [password]`，缺省为 admin/admin123。
 *              注意：本脚本采用 sha256 哈希，与现代 bcrypt 路径不同，仅作为兜底初始化工具。
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import crypto from 'crypto';

/**
 * 创建超级管理员主流程：打开数据库 -> 检查是否已存在 -> 创建账号 -> 退出
 */
async function createSuperAdmin() {
  const dbPath = path.join(__dirname, '../data/database.db');

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // 已存在超级管理员时直接退出，保证幂等
  const existing = await db.get('SELECT id FROM admin_users WHERE role = "super"');

  if (existing) {
    console.log('最高账户已存在');
    process.exit(0);
  }

  // 支持通过命令行参数自定义用户名与密码
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';

  const id = crypto.randomUUID();
  // 注意：此处使用 sha256，与现代 bcrypt 路径不同；首次登录后建议由 initSuperAdmin 升级
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  await db.run(
    'INSERT INTO admin_users (id, username, password_hash, name, role, zone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, username, passwordHash, '系统管理员', 'super', 'default', 1, new Date().toISOString(), new Date().toISOString()]
  );

  console.log(`最高账户创建成功: ${username}`);
  process.exit(0);
}

createSuperAdmin().catch(err => {
  console.error('创建最高账户失败:', err);
  process.exit(1);
});
