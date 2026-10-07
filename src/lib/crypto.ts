/**
 * 密码哈希：PBKDF2-SHA256（WebCrypto），格式 pbkdf2_sha256$iters$saltHex$hashHex
 */
const ITERATIONS = 100000;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2_sha256$${ITERATIONS}$${toHex(salt.buffer)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [alg, iterStr, saltHex, hashHex] = stored.split('$');
    if (alg !== 'pbkdf2_sha256') return false;
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltHex || !hashHex) return false;
    const hash = await pbkdf2(password, fromHex(saltHex), iterations);
    return timingSafeEqual(toHex(hash), hashHex);
  } catch {
    return false;
  }
}

/** 常量时间字符串比较，防时序侧信道 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

/** 不可逆 IP 指纹，用于评论限流与去重（不存明文 IP） */
export async function ipHash(ip: string, salt: string): Promise<string> {
  const hash = await pbkdf2(ip + '|' + salt, enc.encode('berryblog-salt'), 10_000);
  return toHex(hash).slice(0, 32);
}