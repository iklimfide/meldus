(function () {
  'use strict';

  var KEY = 'iklimfide-lang';
  var path = location.pathname || '/';

  if (/^\/meldus(\/|$)/i.test(path)) return;
  if (/^\/arif(\/|$)/i.test(path)) return;
  if (/[?&]__mobile_preview=/.test(location.search)) return;

  function isEnPath(p) {
    return p === '/en' || p === '/en/' || p.indexOf('/en/') === 0;
  }

  function toEnPath(p) {
    if (p === '/' || p === '/index.html' || p === '') return '/en/';
    if (isEnPath(p)) return p === '/en' ? '/en/' : p;
    if (p.charAt(0) !== '/') p = '/' + p;
    return '/en' + p;
  }

  function toTrPath(p) {
    if (p === '/en' || p === '/en/' || p === '/en/index.html') return '/';
    if (p.indexOf('/en/') === 0) return p.slice(3) || '/';
    return p || '/';
  }

  function equivalentPath(wantEn) {
    return wantEn ? toEnPath(path) : toTrPath(path);
  }

  var isBot = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|linkedinbot|pinterest|whatsapp/i.test(navigator.userAgent || '');

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-lang]') : null;
    if (!a) return;
    var lang = a.getAttribute('data-lang');
    if (lang !== 'en' && lang !== 'tr') return;
    e.preventDefault();
    try { localStorage.setItem(KEY, lang); } catch (err) {}
    var dest = equivalentPath(lang === 'en');
    if ((location.pathname || '/') === dest && !location.hash) return;
    location.href = dest + location.search + location.hash;
  });

  if (!isBot) {
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}

    var wantEn = stored === 'en';
    var dest = wantEn ? toEnPath(path) : toTrPath(path);
    if (dest !== path && dest !== path + '/' && dest + '/' !== path) {
      location.replace(dest + location.search + location.hash);
      return;
    }
  }

  function injectLangSwitch() {
    if (document.querySelector('.lang-switch')) return;
    var nav = document.querySelector('header nav');
    if (!nav) return;
    var order = null;
    var kids = nav.children;
    for (var i = 0; i < kids.length; i++) {
      var href = kids[i].getAttribute && kids[i].getAttribute('href');
      if (kids[i].tagName === 'A' && href && /wa\.me/i.test(href)) {
        order = kids[i];
        break;
      }
    }
    if (!order) return;

    if (!document.getElementById('lang-switch-css')) {
      var css = document.createElement('style');
      css.id = 'lang-switch-css';
      css.textContent =
        '.lang-switch{position:relative}' +
        '.lang-switch>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;' +
        'border-radius:9999px;border:1px solid rgba(0,0,0,.1);background:#fff;padding:.5rem .9rem;font-weight:700}' +
        '.lang-switch>summary::-webkit-details-marker{display:none}' +
        '.lang-switch>summary .lang-caret{width:.7em;height:.7em;opacity:.65;flex-shrink:0}' +
        '.lang-switch[open]>summary .lang-caret{transform:rotate(180deg)}' +
        '.lang-switch-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:5.5rem;background:#fff;' +
        'border:1px solid rgba(0,0,0,.1);border-radius:.75rem;box-shadow:0 10px 24px rgba(0,0,0,.12);padding:.25rem;z-index:80}' +
        '.lang-switch-menu a{display:block;padding:.5rem .75rem;border-radius:.5rem;font-weight:700}' +
        '.lang-switch-menu a:hover{background:#f4f4f5}' +
        '.lang-switch-menu a[aria-current="true"]{background:rgba(45,90,39,.1);color:#2d5a27}';
      document.head.appendChild(css);
    }

    var currentEn = isEnPath(path);
    var wrap = document.createElement('details');
    wrap.className = 'lang-switch';
    wrap.innerHTML =
      '<summary aria-label="Language">' +
        (currentEn ? 'EN' : 'TR') +
        '<svg class="lang-caret" viewBox="0 0 12 8" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M1.6 1.8L6 6.2 10.4 1.8"/></svg>' +
      '</summary>' +
      '<div class="lang-switch-menu">' +
        '<a href="/" data-lang="tr" hreflang="tr" lang="tr"' + (currentEn ? '' : ' aria-current="true"') + '>TR</a>' +
        '<a href="/en/" data-lang="en" hreflang="en" lang="en"' + (currentEn ? ' aria-current="true"' : '') + '>EN</a>' +
      '</div>';

    var cluster = document.createElement('div');
    cluster.className = 'flex items-center gap-3';
    nav.style.columnGap = '1.15rem';
    nav.insertBefore(cluster, order);
    cluster.appendChild(wrap);
    cluster.appendChild(order);

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) wrap.removeAttribute('open');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLangSwitch);
  } else {
    injectLangSwitch();
  }
})();
