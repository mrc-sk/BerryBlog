/** 通用工具函数 */

/**
 * 最小请求接口：Hono 的 HonoRequest 类型上不暴露 headers，
 * 所以内部函数统一收窄到只依赖 headers/url 的鸭子类型。
 */
export interface ReqLike {
  headers: Headers;
  url?: string;
}

export function slugify(input: string): string {
  const s = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

export function html(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 相对时间：3 分钟前 / 2 小时前 / 2026-01-01 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const min = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return iso.slice(0, 10);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.replace(' ', 'T').slice(0, 10);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.replace(' ', 'T').slice(0, 16);
}

/** 生成归档分组键，如 2026-10 */
export function archiveKey(iso: string | null): { key: string; label: string; count: number } | null {
  if (!iso) return null;
  const k = iso.slice(0, 7);
  const [y, m] = k.split('-');
  return { key: k, label: `${y} 年 ${Number(m)} 月`, count: 0 };
}

export function paginate(total: number, page: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return {
    total,
    pages,
    current,
    perPage,
    offset: (current - 1) * perPage,
    hasPrev: current > 1,
    hasNext: current < pages,
    prev: current - 1,
    next: current + 1,
  };
}

export function pageUrl(page: number, basePath: string, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  if (page > 1) qs.set('page', String(page));
  const s = qs.toString();
  return `${basePath}${s ? '?' + s : ''}`;
}

export function excerpt(str: string, n = 80): string {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function getClientIp(req: ReqLike): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}