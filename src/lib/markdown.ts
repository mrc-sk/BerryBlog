/**
 * 极简 Markdown 渲染器 —— 零依赖，专为 Workers 运行时设计。
 * 支持：标题、段落、有序/无序/任务列表、代码块（含语言高亮 class）、
 *      行内代码、粗体、斜体、删除线、链接、图片、引用、分割线、表格。
 * 安全：所有文本节点经过 escapeHtml，绝不注入原始 HTML。
 */

export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^[\w.-]+\/[\w./-]*$/.test(u)) return u; // 相对路径
  return '#';
}

/** 行内语法：代码 -> 图片 -> 链接 -> 粗体 -> 斜体 -> 删除线 */
function renderInline(src: string): string {
  const codeSpans: string[] = [];
  // 先摘出行内代码，避免内部再解析
  let text = src.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `CODE${codeSpans.length - 1}`;
  });

  text = escapeHtml(text);

  // 图片：外面套一层 .img-wrap，图片加载完成前显示 dot-motion-loader 动画占位。
  // 博客的图片都是外链，慢的时候是彻底空白，给个视觉反馈。
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt: string, url: string, title?: string) =>
      `<figure class="img-wrap" data-img-load="1"><dot-motion-loader class="img-ph" data-dot-motion-tag="dml-img" aria-hidden="true"></dot-motion-loader>` +
      `<img src="${escapeHtml(safeUrl(url))}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">` +
      `</figure>`);

  // 链接
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, label: string, url: string, title?: string) =>
      `<a href="${escapeHtml(safeUrl(url))}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`);

  // 裸链接自动识别
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  // 粗体 / 斜体 / 删除线
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 硬换行
  text = text.replace(/ {2,}\n/g, '<br>\n');

  // 还原行内代码
  text = text.replace(/CODE(\d+)/g, (_m, i: string) => codeSpans[Number(i)]);

  return text;
}

/** 极简语法高亮：字符串 / 注释 / 数字 / 关键字 */
function highlight(code: string, lang: string): string {
  if (!lang) return escapeHtml(code);
  let out = escapeHtml(code);
  const kw = 'const let var function return if else for while class new await async import export from typeof instanceof this null true false def print import as in not and or None True False elif lambda pass break continue elif';
  out = out.replace(
    new RegExp(`\\b(${kw.split(/\s+/).filter(Boolean).join('|')})\\b`, 'g'),
    '<span class="tok-kw">$1</span>'
  );
  out = out.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, '<span class="tok-str">$1</span>');
  out = out.replace(/(\/\/[^\n]*|#[^\n]*$)/gm, '<span class="tok-com">$1</span>');
  out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
  return out;
}

export interface Heading {
  level: number;
  text: string;
  slug: string;
}

function slugifyHeading(text: string, used: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  toc: string;
}

/**
 * @param md     Markdown 原文
 * @param opts.withToc 是否生成目录（默认 true）
 */
export function renderMarkdown(md: string, opts: { withToc?: boolean } = {}): RenderResult {
  const withToc = opts.withToc !== false;
  const src = String(md ?? '').replace(/\r\n?/g, '\n');

  // 1) 抽出围栏代码块
  const blocks: string[] = [];
  let text = src.replace(/```([\w+-]*)\n([\s\S]*?)(?:```|$)/g, (_m, lang: string, code: string) => {
    blocks.push(
      `<pre class="code-block" data-lang="${escapeHtml(lang || 'text')}"><code class="language-${escapeHtml(lang || 'text')}">${highlight(code.replace(/\n$/, ''), lang.toLowerCase())}</code></pre>`
    );
    return `BLOCK${blocks.length - 1}`;
  });

  const lines = text.split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const usedSlugs = new Map<string, number>();

  let i = 0;
  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    out.push(`<p>${renderInline(buf.join('\n'))}</p>`);
    buf.length = 0;
  };
  let para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // 代码块占位符单独成行
    const blockOnly = line.match(/^BLOCK(\d+)$/);
    if (blockOnly) {
      flushParagraph(para);
      out.push(blocks[Number(blockOnly[1])]);
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const inner = renderInline(h[2].trim());
      const slug = slugifyHeading(h[2], usedSlugs);
      if (withToc) headings.push({ level, text: h[2].replace(/[*_`~[\]()]/g, ''), slug });
      out.push(`<h${level} id="${slug}"><a class="anchor" href="#${slug}">#</a>${inner}</h${level}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i++;
      continue;
    }

    // 表格
    if (line.includes('|') && lines[i + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushParagraph(para);
      const parseRow = (l: string) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, c) => `<td>${renderInline(r[c] ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      );
      continue;
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), { withToc: false }).html}</blockquote>`);
      continue;
    }

    // 无序 / 任务列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph(para);
      const isTask = /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*[-*+]\s+/, '');
        if (isTask) {
          const done = /^\[[xX]\]/.test(t);
          t = t.replace(/^\[[xX]\]\s*/, '');
          items.push(
            `<li class="task-item"><input type="checkbox" disabled${done ? ' checked' : ''}> <span${done ? ' class="done"' : ''}>${renderInline(t)}</span></li>`
          );
        } else {
          items.push(`<li>${renderInline(t)}</li>`);
        }
        i++;
      }
      out.push(`<ul${isTask ? ' class="task-list"' : ''}>${items.join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph(para);
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 空行
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }

    // 缩进代码块（4 空格）
    if (/^( {4}|\t)/.test(line)) {
      flushParagraph(para);
      const buf: string[] = [];
      while (i < lines.length && /^( {4}|\t)/.test(lines[i])) {
        buf.push(lines[i].replace(/^( {4}|\t)/, ''));
        i++;
      }
      blocks.push('');
      const idx = blocks.length - 1;
      blocks[idx] = `<pre class="code-block" data-lang="text"><code class="language-text">${escapeHtml(buf.join('\n'))}</code></pre>`;
      out.push(blocks[idx]);
      continue;
    }

    para.push(line);
    i++;
  }
  flushParagraph(para);

  // 还原被段落吞掉的代码块占位符
  let html = out.join('\n');
  html = html.replace(/BLOCK(\d+)/g, (_m, n: string) => blocks[Number(n)] ?? '');

  const toc = withToc ? buildToc(headings) : '';

  return { html, headings, toc };
}

function buildToc(headings: Heading[]): string {
  const hs = headings.filter((x) => x.level >= 2 && x.level <= 4);
  if (hs.length < 2) return '';
  let depth = 0;
  const parts: string[] = ['<nav class="toc"><div class="toc-title">目录</div>'];
  for (const h of hs) {
    while (depth < h.level - 2) {
      parts.push('<ul>');
      depth++;
    }
    while (depth > h.level - 2) {
      parts.push('</ul>');
      depth--;
    }
    parts.push(`<li><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`);
  }
  while (depth > 0) {
    parts.push('</ul>');
    depth--;
  }
  parts.push('</nav>');
  return parts.join('');
}

/** 中文按字数统计，英文按词数 */
export function countWords(md: string): number {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-|]/g, ' ');
  const cjk = (plain.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
  const words = (plain.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}

/** 从正文自动提取摘要 */
export function extractSummary(md: string, len = 120): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > len ? plain.slice(0, len) + '…' : plain;
}

/** 取封面图：优先 markdown 第一张图 */
export function extractCover(md: string): string {
  const m = md.match(/!\[[^\]]*\]\(([^)\s]+)/);
  return m ? safeUrl(m[1]) : '';
}