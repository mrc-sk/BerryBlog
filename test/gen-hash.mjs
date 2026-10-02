/**
 * 生成 seed.sql 里使用的真实 PBKDF2 密码哈希。
 * 用法：node test/gen-hash.mjs <password> [username]
 */
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

// crypto.ts 依赖全局 crypto.subtle，Node 18+ 需要显式挂载
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const password = process.argv[2] || 'admin123';
const username = process.argv[3] || 'admin';
const hash = process.argv[4] || null;

const tmp = resolve(root, '.tmp-crypto.mjs');
await build({
  entryPoints: [resolve(root, 'src/lib/crypto.ts')],
  outfile: tmp,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
});
const { hashPassword, verifyPassword } = await import('file://' + tmp.replace(/\\/g, '/'));

const out = hash || (await hashPassword(password));
const ok = await verifyPassword(password, out);
if (!ok) {
  console.error('✗ 自校验失败');
  process.exit(1);
}
console.log('username:', username);
console.log('password:', hash ? '(保留原密码)' : password);
console.log('hash:', out);
console.log('自校验: ok');

if (!process.argv.includes('--print-only')) {
  // 固定使用确定性哈希，让 seed.sql 可重复
  const path = resolve(root, 'schema/seed.sql');
  const sql = readFileSync(path, 'utf8');
  const updated = sql.replace(
    /\('([a-z0-9_]+)',\s*'pbkdf2_sha256\$[^']*'\)/i,
    `('${username}', '${out}')`
  );
  if (updated !== sql) {
    writeFileSync(path, updated, 'utf8');
    console.log('\n✓ seed.sql 已更新密码哈希');
  } else {
    console.log('\n· seed.sql 中未找到可替换的 users 记录（可能已更新）');
  }
}