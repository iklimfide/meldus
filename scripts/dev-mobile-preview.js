(function () {
  'use strict';

  var STORAGE_KEY = 'ikf-dev-mobile-preview';
  var EMBED_PARAM = '__mobile_preview';
  var WIDTH_PARAM = '__preview_width';

  var DEVICES = [
    { id: 'iphone-se', label: 'iPhone SE', width: 375 },
    { id: 'iphone-14', label: 'iPhone 14', width: 390 },
    { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430 },
  ];

  function isLocalDev() {
    var host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.localhost$/i.test(host);
  }

  function getSearchParams() {
    return new URLSearchParams(window.location.search);
  }

  function isEmbed() {
    return getSearchParams().get(EMBED_PARAM) === '1';
  }

  function applyEmbedViewport() {
    var params = getSearchParams();
    var width = parseInt(params.get(WIDTH_PARAM) || '390', 10);
    if (!width || width < 320) width = 390;

    document.documentElement.classList.add('ikf-embed-preview');

    var meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute('content', 'width=' + width + ', initial-scale=1, maximum-scale=1');
    }
  }

  function readStoredState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { open: false, deviceId: 'iphone-14' };
      var parsed = JSON.parse(raw);
      var deviceId = 'iphone-14';
      for (var i = 0; i < DEVICES.length; i++) {
        if (DEVICES[i].id === parsed.deviceId) {
          deviceId = parsed.deviceId;
          break;
        }
      }
      return { open: Boolean(parsed.open), deviceId: deviceId };
    } catch (e) {
      return { open: false, deviceId: 'iphone-14' };
    }
  }

  function writeStoredState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function getDevice(deviceId) {
    for (var i = 0; i < DEVICES.length; i++) {
      if (DEVICES[i].id === deviceId) return DEVICES[i];
    }
    return DEVICES[1];
  }

  function buildIframeSrc(deviceWidth) {
    var params = getSearchParams();
    params.set(EMBED_PARAM, '1');
    params.set(WIDTH_PARAM, String(deviceWidth));
    var qs = params.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  }

  function injectStyles() {
    if (document.getElementById('ikf-dev-mobile-preview-styles')) return;
    var style = document.createElement('style');
    style.id = 'ikf-dev-mobile-preview-styles';
    style.textContent = [
      '.ikf-dev-preview-toggle{position:fixed;bottom:1rem;left:1rem;z-index:10000;display:flex;align-items:center;gap:.5rem;border:0;border-radius:9999px;background:#0f172a;color:#fff;padding:.625rem 1rem;font:600 .875rem/1.2 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 25px rgba(15,23,42,.35);cursor:pointer;transition:background .15s ease}',
      '.ikf-dev-preview-toggle:hover{background:#1e293b}',
      '.ikf-dev-preview-panel{position:fixed;top:1rem;right:1rem;bottom:1rem;z-index:9999;display:none;flex-direction:column;width:min(calc(100vw - 2rem),28rem);padding:.75rem;border:1px solid #cbd5e1;border-radius:2rem;background:#f1f5f9;box-shadow:0 25px 50px rgba(15,23,42,.25)}',
      '.ikf-dev-preview-panel.is-open{display:flex}',
      '.ikf-dev-preview-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.75rem;padding:0 .25rem}',
      '.ikf-dev-preview-header-actions{display:flex;align-items:center;gap:.25rem}',
      '.ikf-dev-preview-kicker{margin:0;font:700 .75rem/1.2 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#64748b}',
      '.ikf-dev-preview-title{margin:.125rem 0 0;font:600 .875rem/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b}',
      '.ikf-dev-preview-icon-btn{border:0;border-radius:.5rem;background:transparent;padding:.35rem .55rem;font:500 .8rem/1 system-ui,-apple-system,Segoe UI,sans-serif;color:#475569;cursor:pointer}',
      '.ikf-dev-preview-icon-btn:hover{background:#fff}',
      '.ikf-dev-preview-label{display:block;margin-bottom:.75rem;padding:0 .25rem;font:500 .75rem/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#475569}',
      '.ikf-dev-preview-select{display:block;width:100%;margin-top:.25rem;border:1px solid #cbd5e1;border-radius:.5rem;background:#fff;padding:.5rem .75rem;font:400 .875rem/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b}',
      '.ikf-dev-preview-stage{display:flex;flex:1;min-height:0;align-items:stretch;justify-content:center;overflow:hidden;border:1px solid #cbd5e1;border-radius:1.5rem;background:#fff;padding:.5rem}',
      '.ikf-dev-preview-frame-wrap{flex:1;min-height:0;max-width:100%;overflow:hidden;border:1px solid #e2e8f0;border-radius:1.25rem;background:#fff;box-shadow:inset 0 0 0 1px rgba(148,163,184,.15);display:flex;flex-direction:column}',
      '.ikf-dev-preview-frame{flex:1;min-height:0;width:100%;border:0;background:#fff;display:block}',
      '.ikf-dev-preview-note{margin:.75rem 0 0;padding:0 .25rem;text-align:center;font:400 .6875rem/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#64748b}',
    ].join('');
    document.head.appendChild(style);
  }

  function createDeviceOptions(deviceId) {
    return DEVICES.map(function (device) {
      var option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.label + ' (' + device.width + 'px)';
      if (device.id === deviceId) option.selected = true;
      return option;
    });
  }

  function initParentPreview() {
    if (!isLocalDev() || isEmbed()) return;

    injectStyles();

    var state = readStoredState();
    var open = state.open;
    var deviceId = state.deviceId;
    var currentSrc = '';
    var locationKey = window.location.pathname + window.location.search;

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'ikf-dev-preview-toggle';
    toggleBtn.setAttribute('aria-controls', 'ikf-dev-mobile-preview-panel');

    var panel = document.createElement('aside');
    panel.id = 'ikf-dev-mobile-preview-panel';
    panel.className = 'ikf-dev-preview-panel';
    panel.setAttribute('aria-label', 'Mobil tasarım önizlemesi');

    var header = document.createElement('div');
    header.className = 'ikf-dev-preview-header';

    var heading = document.createElement('div');
    var kicker = document.createElement('p');
    kicker.className = 'ikf-dev-preview-kicker';
    kicker.textContent = 'Dev only';
    var title = document.createElement('p');
    title.className = 'ikf-dev-preview-title';
    title.textContent = 'Mobil önizleme';
    heading.appendChild(kicker);
    heading.appendChild(title);

    var headerActions = document.createElement('div');
    headerActions.className = 'ikf-dev-preview-header-actions';

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'ikf-dev-preview-icon-btn';
    refreshBtn.setAttribute('aria-label', 'Önizlemeyi yenile');
    refreshBtn.title = 'Önizlemeyi yenile';
    refreshBtn.textContent = '↻';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ikf-dev-preview-icon-btn';
    closeBtn.setAttribute('aria-label', 'Mobil önizlemeyi kapat');
    closeBtn.title = 'Kapat';
    closeBtn.textContent = '✕';

    headerActions.appendChild(refreshBtn);
    headerActions.appendChild(closeBtn);
    header.appendChild(heading);
    header.appendChild(headerActions);

    var label = document.createElement('label');
    label.className = 'ikf-dev-preview-label';
    label.textContent = 'Cihaz';

    var select = document.createElement('select');
    select.className = 'ikf-dev-preview-select';
    createDeviceOptions(deviceId).forEach(function (option) {
      select.appendChild(option);
    });
    label.appendChild(select);

    var stage = document.createElement('div');
    stage.className = 'ikf-dev-preview-stage';

    var frameWrap = document.createElement('div');
    frameWrap.className = 'ikf-dev-preview-frame-wrap';

    var iframe = document.createElement('iframe');
    iframe.className = 'ikf-dev-preview-frame';
    iframe.title = 'Mobil önizleme';

    frameWrap.appendChild(iframe);
    stage.appendChild(frameWrap);

    var note = document.createElement('p');
    note.className = 'ikf-dev-preview-note';
    note.textContent = 'Gerçek mobil breakpoint\'leri için iframe kullanılır. Sayfa değiştikçe önizleme senkron kalır.';

    panel.appendChild(header);
    panel.appendChild(label);
    panel.appendChild(stage);
    panel.appendChild(note);

    function renderToggle() {
      toggleBtn.style.display = open ? 'none' : 'flex';
      toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggleBtn.title = 'Mobil tasarım önizlemesini aç';
      toggleBtn.innerHTML = '<span aria-hidden="true">📱</span> Mobil önizleme';
    }

    function loadIframe(force) {
      var device = getDevice(deviceId);
      var nextSrc = buildIframeSrc(device.width);
      frameWrap.style.width = device.width + 'px';
      frameWrap.style.maxWidth = '100%';
      iframe.title = 'Mobil önizleme - ' + device.label;

      if (force || nextSrc !== currentSrc) {
        currentSrc = nextSrc;
        iframe.src = nextSrc;
      } else if (iframe.contentWindow) {
        try {
          iframe.contentWindow.location.reload();
        } catch (e) {
          iframe.src = nextSrc;
        }
      }
    }

    function syncFromLocation() {
      var nextKey = window.location.pathname + window.location.search;
      if (!open || nextKey === locationKey) return;
      locationKey = nextKey;
      loadIframe(true);
    }

    function setOpen(nextOpen) {
      open = nextOpen;
      panel.classList.toggle('is-open', open);
      renderToggle();
      writeStoredState({ open: open, deviceId: deviceId });
      if (open) {
        locationKey = window.location.pathname + window.location.search;
        loadIframe(true);
      } else {
        currentSrc = '';
        iframe.removeAttribute('src');
      }
    }

    toggleBtn.addEventListener('click', function () {
      setOpen(true);
    });
    closeBtn.addEventListener('click', function () {
      setOpen(false);
    });
    refreshBtn.addEventListener('click', function () {
      if (open) loadIframe(true);
    });
    select.addEventListener('change', function () {
      deviceId = select.value;
      writeStoredState({ open: open, deviceId: deviceId });
      if (open) loadIframe(true);
    });

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);

    var pushState = history.pushState;
    var replaceState = history.replaceState;
    history.pushState = function () {
      pushState.apply(history, arguments);
      syncFromLocation();
    };
    history.replaceState = function () {
      replaceState.apply(history, arguments);
      syncFromLocation();
    };

    renderToggle();
    document.body.appendChild(toggleBtn);
    document.body.appendChild(panel);
    if (open) setOpen(true);
  }

  if (isEmbed()) {
    applyEmbedViewport();
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initParentPreview);
  } else {
    initParentPreview();
  }
})();
