/* Nova Blog · 前端交互 */
(function () {
  'use strict';

  /* ------------------------------------------------------ 主题切换 */
  var toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  }

  /* ------------------------------------------------------ 阅读进度 */
  var bar = document.getElementById('progress');
  if (bar) {
    var ticking = false;
    var update = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* -------------------------------------------------------- 搜索面板 */
  var panel = document.getElementById('searchPanel');
  var input = document.getElementById('searchInput');
  var btn = document.getElementById('navSearch');

  function openSearch() {
    if (!panel) return;
    panel.hidden = false;
    if (input) { input.focus(); input.select(); }
  }
  function closeSearch() {
    if (!panel) return;
    panel.hidden = true;
  }
  if (btn) btn.addEventListener('click', function () { panel.hidden ? openSearch() : closeSearch(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      openSearch();
    }
    if (e.key === 'Escape') closeSearch();
    // Ctrl/Cmd + K
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  /* ------------------------------------------------------ 评论回复 */
  var hint = document.getElementById('replyHint');
  var replyTo = document.getElementById('replyTo');
  var form = document.getElementById('comment-form');
  var authorField = form && form.querySelector('[name="author"]');

  document.querySelectorAll('[data-reply]').forEach(function (btn2) {
    btn2.addEventListener('click', function () {
      if (!hint || !replyTo) return;
      replyTo.value = btn2.getAttribute('data-reply');
      hint.hidden = false;
      hint.innerHTML = '正在回复 <strong>' + btn2.getAttribute('data-author') + '</strong>' +
        '<a href="#" id="cancelReply">取消</a>';
      document.getElementById('cancelReply').addEventListener('click', function (e) {
        e.preventDefault();
        replyTo.value = '';
        hint.hidden = true;
      });
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (authorField) authorField.focus();
    });
  });

  /* ---------------------------------------------- 目录高亮 + 锚点 */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var targets = tocLinks
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var visible = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) visible.add(en.target.id);
        else visible.delete(en.target.id);
      });
      var first = targets.find(function (t) { return visible.has(t.id); });
      tocLinks.forEach(function (a) {
        a.classList.toggle('active', first && a.getAttribute('href') === '#' + first.id);
      });
    }, { rootMargin: '-90px 0px -70% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  }

  /* -------------------------------------------------- 删除二次确认 */
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });
})();
/* ------------------------------------------- 图片加载占位（dot-motion-loader） */
(function () {
  var wraps = document.querySelectorAll('[data-img-load="1"]');
  if (!wraps.length) return;

  function done(wrap, ok) {
    if (wrap.dataset.imgState) return;   // 只处理一次
    wrap.dataset.imgState = ok ? 'ok' : 'err';
    wrap.classList.add('is-loaded');
    if (!ok) wrap.classList.add('is-error');
    var ph = wrap.querySelector('.img-ph');
    // 淡出后从 DOM 摘掉，动画不再占用合成层
    if (ph) {
      ph.addEventListener('transitionend', function () { ph.remove(); }, { once: true });
      setTimeout(function () { ph.remove(); }, 600);
    }
  }

  wraps.forEach(function (wrap) {
    var img = wrap.querySelector('img');
    if (!img) return;
    // 已在缓存里时 load 不会再触发，所以先查 complete
    if (img.complete) { done(wrap, img.naturalWidth > 0); return; }
    img.addEventListener('load', function () { done(wrap, true); }, { once: true });
    img.addEventListener('error', function () { done(wrap, false); }, { once: true });
  });

  /* 兜底：loading="lazy" 的图进了视口才会开始加载；若网络一直挂着，
     占位会永久显示。这里用 IntersectionObserver 兜一层，超时或出视口都收尾。*/
  var slow = [];
  wraps.forEach(function (wrap) {
    var img = wrap.querySelector('img');
    if (!img || img.complete) return;
    var timer = setTimeout(function () { done(wrap, false); }, 20000);
    slow.push([wrap, timer]);
  });
  if (slow.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var pair = slow.find(function (s) { return s[0] === e.target; });
        if (!pair) return;
        var img = e.target.querySelector('img');
        if (img) img.addEventListener('load', function () { done(e.target, true); }, { once: true });
      });
    }, { rootMargin: '200px' });
    slow.forEach(function (s) { io.observe(s[0]); });
  }
})();
