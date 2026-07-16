import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import crypto from 'crypto';

async function createSuperAdmin() {
  const dbPath = path.join(__dirname, '../data/database.db');
  
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  const existing = await db.get('SELECT id FROM admin_users WHERE role = "super"');
  
  if (existing) {
    console.log('最高账户已存在');
    process.exit(0);
  }

  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';
  
  const id = crypto.randomUUID();
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