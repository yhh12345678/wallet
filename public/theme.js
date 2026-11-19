(function () {
  'use strict';

  const key = 'wallet-theme';
  const root = document.documentElement;
  const browserBar = document.querySelector('meta[name="theme-color"]');

  function apply(value) {
    const dark = value !== 'light';
    root.dataset.theme = dark ? 'dark' : 'light';
    browserBar?.setAttribute('content', dark ? '#10141d' : '#f7f8fc');
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? '切换浅色模式' : '切换深色模式';
    }
  }

  try { apply(localStorage.getItem(key)); } catch { apply('dark'); }

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(key, next); } catch { /* The current page keeps its selection. */ }
  });

  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
