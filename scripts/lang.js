(function () {
  'use strict';

  var KEY = 'iklimfide-lang';
  var path = location.pathname || '/';

  if (/^\/meldus(\/|$)/i.test(path)) return;
  if (/[?&]__mobile_preview=/.test(location.search)) return;
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|linkedinbot|pinterest|whatsapp/i.test(navigator.userAgent || '')) return;

  function isTrCode(code) {
    code = String(code || '').toLowerCase().replace('_', '-');
    return code === 'tr' || code.indexOf('tr-') === 0;
  }

  function browserIsTr() {
    var primary = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return isTrCode(primary);
  }

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

  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  var currentlyEn = isEnPath(path);
  var wantEn = stored === 'en' ? true : stored === 'tr' ? false : !browserIsTr();

  if (wantEn && !currentlyEn) {
    location.replace(toEnPath(path) + location.search + location.hash);
  } else if (stored === 'tr' && currentlyEn) {
    location.replace(toTrPath(path) + location.search + location.hash);
  }
})();
