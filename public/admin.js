/* Nova Blog · 后台交互：工具栏 / 字数 / 预览 / 标签快捷 */
(function () {
  'use strict';

  var ta = document.getElementById('contentInput');
  var titleInput = document.querySelector('.title-input');
  var slugInput = document.querySelector('[name="slug"]');
  var slugHint = document.getElementById('slugHint');
  var wc = document.getElementById('wordCount');
  var lc = document.getElementById('leftCount');

  /* ------------------------------------------------------ Markdown 工具栏 */
  var WRAP = {
    bold: ['**', '**', '粗体'],
    italic: ['*', '*', '斜体'],
    code: ['`', '`', 'code'],
    h2: ['## ', '', '小标题'],
    h3: ['### ', '', '小标题'],
    quote: ['> ', '', '引用'],
    ul: ['- ', '', '列表项'],
    ol: ['1. ', '', '列表项'],
    codeblock: ['```js\n', '\n```', 'code()'],
    hr: ['\n---\n', '', ''],
  };

  function surround(before, after, placeholder) {
    if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var val = ta.value;
    var selected = val.slice(s, e) || placeholder;
    ta.value = val.slice(0, s) + before + selected + after + val.slice(e);
    var start = s + before.length;
    ta.focus();
    ta.setSelectionRange(start, start + selected.length);
    onInput();
  }

  function prefixLine(before, placeholder) {
    if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var val = ta.value;
    var lineStart = val.lastIndexOf('\n', s - 1) + 1;
    var block = val.slice(lineStart, e) || placeholder;
    var prefixed = block.split('\n').map(function (l, i) {
      return before.replace('1.', String(i + 1)) + l;
    }).join('\n');
    ta.value = val.slice(0, lineStart) + prefixed + val.slice(e);
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + prefixed.length);
    onInput();
  }

  document.querySelectorAll('#toolbar button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var kind = btn.getAttribute('data-md');
      if (kind === 'link') return surround('[', '](https://)', '链接文字');
      if (kind === 'hr') return surround('\n---\n', '', '');
      if (kind === 'ol') return prefixLine('1. ', '列表项');
      if (kind === 'ul') return prefixLine('- ', '列表项');
      if (kind === 'quote') return prefixLine('> ', '引用');
      if (kind === 'h2' || kind === 'h3') return prefixLine(WRAP[kind][0], WRAP[kind][2]);
      var w = WRAP[kind];
      if (w) surround(w[0], w[1], w[2]);
    });
  });

  /* ---------------------------------------------------------- 字数统计 */
  function countWords(md) {
    var plain = String(md)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~\-|]/g, ' ');
    var cjk = (plain.match(/[\u4e00-\u9fa5\u3040-\u30ff]/g) || []).length;
    var words = (plain.replace(/[\u4e00-\u9fa5\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + words;
  }

  function onInput() {
    if (!ta) return;
    var n = countWords(ta.value);
    if (wc) wc.textContent = n;
    if (lc) lc.textContent = 20000 - n;
    updateSlugHint();
  }

  function slugify(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^\w\u4e00-\u9fa5-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  }

  function updateSlugHint() {
    if (!slugHint || !titleInput) return;
    var manual = slugInput && slugInput.value.trim();
    slugHint.textContent = manual ? '手动指定' : '将自动生成：/' + slugify(titleInput.value);
  }

  if (ta) {
    ta.addEventListener('input', onInput);
    onInput();
  }
  if (titleInput) {
    titleInput.addEventListener('input', updateSlugHint);
    updateSlugHint();
  }

  /* -------------------------------------------------------------- 预览 */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(src) {
    var codes = [];
    var t = esc(src).replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push('<code>' + c + '</code>');
      return 'C' + (codes.length - 1) + '';
    });
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return t.replace(/C(\d+)/g, function (m, i) { return codes[Number(i)]; });
  }

  function simpleMd(md) {
    var out = [];
    var lines = String(md).split('\n');
    var inCode = false, codeBuf = [];
    var listBuf = null, listOrdered = false;
    var quoteBuf = [];

    function flushList() {
      if (listBuf) {
        var tag = listOrdered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + listBuf.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</' + tag + '>');
        listBuf = null;
      }
    }
    function flushQuote() {
      if (quoteBuf.length) {
        out.push('<blockquote>' + inline(quoteBuf.join('\n')) + '</blockquote>');
        quoteBuf = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^```/.test(line)) {
        if (inCode) {
          out.push('<pre class="code-block"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = []; inCode = false;
        } else { flushList(); flushQuote(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushList(); flushQuote(); var lv = h[1].length; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); continue; }

      if (/^\s*>\s?/.test(line)) { flushList(); quoteBuf.push(line.replace(/^\s*>\s?/, '')); continue; }
      else flushQuote();

      var ul = line.match(/^\s*[-*+]\s+(.*)$/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        var ordered = !!ol;
        if (listBuf && listOrdered !== ordered) flushList();
        listOrdered = ordered;
        (listBuf = listBuf || []).push(inline((ul || ol)[1]));
        continue;
      }
      flushList();

      if (/^\s*[-*_]\s*[-*_]\s*[-*_]/.test(line)) { out.push('<hr>'); continue; }

      // 表格：当前行含 |，且下一行是分隔行
      if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) {
        flushList();
        const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
        out.push(
          '<div class="table-wrap"><table><thead><tr>' +
          head.map((c) => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>'
        );
        continue;
      }

      if (!line.trim()) continue;
      out.push('<p>' + inline(line) + '</p>');
    }
    if (inCode && codeBuf.length) out.push('<pre class="code-block"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
    flushList(); flushQuote();
    return out.join('\n');
  }

  var modal = document.getElementById('previewModal');
  var prevBody = document.getElementById('previewBody');
  var closeBtn = document.getElementById('closePreview');
  var previewBtn = null;

  if (modal && prevBody && ta) {
    // 在保存按钮旁插入预览按钮
    var saveBtn = document.querySelector('.editor-side .btn-primary');
    if (saveBtn) {
      previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'btn-ghost block';
      previewBtn.textContent = '预览正文';
      previewBtn.addEventListener('click', function () {
        prevBody.innerHTML = simpleMd(ta.value) || '<p class="muted">（空）</p>';
        modal.hidden = false;
      });
      saveBtn.parentNode.insertBefore(previewBtn, saveBtn.nextSibling);
    }
    var hide = function () { modal.hidden = true; };
    if (closeBtn) closeBtn.addEventListener('click', hide);
    modal.addEventListener('click', function (e) { if (e.target === modal) hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  }

  /* ------------------------------------------------------- 标签快捷点击 */
  var tagChips = document.querySelectorAll('.small-chips .chip');
  var tagInput = document.querySelector('[name="tags"]');
  tagChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (!tagInput) return;
      var name = chip.getAttribute('data-tag');
      var list = tagInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var idx = list.indexOf(name);
      if (idx >= 0) list.splice(idx, 1);
      else if (list.length < 10) list.push(name);
      tagInput.value = list.join(', ');
    });
  });

  /* ------------------------------------------------------------ 快捷键 */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && ta) {
      e.preventDefault();
      var form = document.getElementById('postForm');
      if (form) form.submit();
    }
  });
})();
/* ------------------------------------------------- 下载源：动态增删行 */
(function () {
  var list = document.getElementById('src-list');
  var addBtn = document.getElementById('src-add');
  if (!list || !addBtn) return;

  var ICON = '✕';

  function bindDel(row) {
    var del = row.querySelector('.src-del');
    if (!del) return;
    del.addEventListener('click', function () {
      // 至少留一行，省得表单变成空数组
      if (list.querySelectorAll('.src-row').length <= 1) {
        row.querySelectorAll('input').forEach(function (i) { i.value = ''; });
        return;
      }
      row.remove();
    });
  }

  list.querySelectorAll('.src-row').forEach(bindDel);

  addBtn.addEventListener('click', function () {
    var row = document.createElement('div');
    row.className = 'src-row';
    row.innerHTML =
      '<input name="src_label" maxlength="20" placeholder="来源名">' +
      '<input name="src_url" maxlength="2000" placeholder="https://...">' +
      '<button type="button" class="link-btn danger src-del" title="删除这行">' + ICON + '</button>';
    list.appendChild(row);
    bindDel(row);
    var first = row.querySelector('input');
    if (first) first.focus();
  });
})();
