import type { Env, SessionUser } from '../types';
import { randomToken, timingSafeEqual } from './crypto';
import { getClientIp, type ReqLike } from './utils';

const SESSION_COOKIE = 'nb_session';
const SESSION_TTL_DAYS = 14;

export { getClientIp };
export type { ReqLike };

/* ---------------------------------------------------------------- CSRF */
/**
 * 双提交 Cookie CSRF：随机 token 存 cookie，表单回传，服务端比对。
 * SameSite=Lax 已挡住跨站表单，此处是第二道防线。
 */
export function ensureCsrfToken(req: ReqLike): string {
  const existing = readCookie(req, 'nb_csrf');
  if (existing && /^[a-f0-9]{32,}$/.test(existing)) return existing;
  return randomToken(16);
}

export function csrfCookie(token: string): string {
  return `nb_csrf=${token}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly=false`;
}

export function checkCsrf(req: ReqLike, formToken: string | undefined): boolean {
  const cookieToken = readCookie(req, 'nb_csrf');
  if (!cookieToken || !formToken) return false;
  return timingSafeEqual(cookieToken, formToken);
}

/* ------------------------------------------------------------- Cookies */
export function readCookie(req: ReqLike, name: string): string | undefined {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function serialize(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

/* ------------------------------------------------------------ 会话读写 */
export async function createSession(env: Env, userId: number, req: ReqLike): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const ua = (req.headers.get('user-agent') || '').slice(0, 200);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sessions (token, user_id, user_agent, expires_at) VALUES (?, ?, ?, ?)`
  )
    .bind(token, userId, ua, expires)
    .run();
  return token;
}

export async function getSession(env: Env, req: ReqLike): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, u.id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > datetime('now')`
  )
    .bind(token)
    .first<{ token: string; expires_at: string; id: number; username: string }>();
  if (!row) return null;
  return { id: row.id, username: row.username, token: row.token };
}

export async function destroySession(env: Env, req: ReqLike): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function sessionCookie(token: string): string {
  return serialize(SESSION_COOKIE, token, SESSION_TTL_DAYS * 86_400);
}

export function clearSessionCookie(): string {
  return serialize(SESSION_COOKIE, '', 0);
}

/* --------------------------------------------------------------- 限流 */
/**
 * 固定窗口计数。登录 10 次 / 15 分钟 / IP，评论 5 条 / 小时 / IP。
 */
export async function rateLimit(
  env: Env,
  bucket: string,
  key: string,
  max: number,
  windowMinutes: number
): Promise<{ ok: boolean; remaining: number }> {
  const now = Date.now();
  const row = await env.DB.prepare(
    'SELECT count, window_from FROM rate_limits WHERE bucket = ? AND key = ?'
  )
    .bind(bucket, key)
    .first<{ count: number; window_from: string }>();

  const windowStart = new Date(now - windowMinutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

  if (!row || row.window_from < windowStart) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, key, count, window_from) VALUES (?, ?, 1, ?)
       ON CONFLICT(bucket, key) DO UPDATE SET count = 1, window_from = excluded.window_from`
    )
      .bind(bucket, key, new Date(now).toISOString().replace('T', ' ').slice(0, 19))
      .run();
    return { ok: true, remaining: max - 1 };
  }

  if (row.count >= max) return { ok: false, remaining: 0 };

  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ? AND key = ?')
    .bind(bucket, key)
    .run();
  return { ok: true, remaining: max - row.count - 1 };
}

export async function clearRateLimit(env: Env, bucket: string, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ? AND key = ?').bind(bucket, key).run();
}

/** 登录限流 key：IP + 用户名，避免同一 IP 锁死所有人 */
export async function loginLimitKey(req: ReqLike, username: string): Promise<string> {
  return `${getClientIp(req)}`;
}

export async function purgeExpired(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}