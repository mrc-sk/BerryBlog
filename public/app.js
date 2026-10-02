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