(function () {
  'use strict';

  var BUCKET = 'alacak';
  var OBJECT = 'guncel.pdf';
  var FALLBACK = '/alacak/Alacak.pdf';
  var MAX_BYTES = 20 * 1024 * 1024;

  var iframe = document.getElementById('alacak-pdf');
  var emptyEl = document.getElementById('alacak-empty');
  var metaEl = document.getElementById('alacak-meta');
  var errEl = document.getElementById('alacak-error');
  var fileEl = document.getElementById('alacak-file');
  var fileLabel = document.getElementById('alacak-file-label');
  var supabaseClient = null;

  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.SUPABASE_URL === 'undefined' || typeof window.SUPABASE_ANON_KEY === 'undefined' || !window.supabase) {
      return null;
    }
    supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  function setBusy(busy) {
    if (fileEl) fileEl.disabled = !!busy;
    if (fileLabel) fileLabel.setAttribute('aria-disabled', busy ? 'true' : 'false');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatYuklemeTarihi(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (!d || isNaN(d.getTime())) return '';
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function sonYuklemeYazisi(value) {
    var t = formatYuklemeTarihi(value);
    return t ? ('Son yükleme: ' + t) : 'Son yükleme tarihi yok';
  }

  function showPdf(url, when) {
    if (emptyEl) emptyEl.hidden = true;
    if (iframe) {
      iframe.hidden = false;
      iframe.src = url;
    }
    if (metaEl) metaEl.textContent = sonYuklemeYazisi(when);
  }

  function showEmpty(label) {
    if (iframe) {
      iframe.hidden = true;
      iframe.removeAttribute('src');
    }
    if (emptyEl) emptyEl.hidden = false;
    if (metaEl) metaEl.textContent = label || 'Henüz PDF yok — yükleme tarihi yok';
  }

  function storageErrorHint(err) {
    var msg = err && (err.message || err.error || err) ? String(err.message || err.error || err) : '';
    if (/bucket|not found|does not exist/i.test(msg)) {
      return 'PDF deposu yok. Supabase SQL Editor’da meldus/sql/alacak_pdf.sql dosyasını çalıştırın.';
    }
    return msg || 'PDF yüklenemedi.';
  }

  function fileUpdatedAt(item) {
    if (!item) return null;
    return item.updated_at || item.created_at || (item.metadata && item.metadata.updated_at) || null;
  }

  function showFallbackPdf() {
    var url = FALLBACK + '?t=' + Date.now();
    fetch(FALLBACK, { method: 'HEAD' }).then(function (res) {
      var lm = res.headers.get('last-modified');
      showPdf(url, lm || null);
    }).catch(function () {
      showPdf(url, null);
    });
  }

  function loadStoredPdf() {
    var sb = getClient();
    if (!sb) {
      showFallbackPdf();
      return;
    }
    Promise.all([
      sb.storage.from(BUCKET).createSignedUrl(OBJECT, 3600),
      sb.storage.from(BUCKET).list('', { search: OBJECT, limit: 50 })
    ]).then(function (results) {
      var signed = results[0];
      var listed = results[1];
      var item = ((listed && listed.data) || []).filter(function (row) {
        return row && row.name === OBJECT;
      })[0];
      if (!signed || signed.error || !signed.data || !signed.data.signedUrl || !item) {
        showFallbackPdf();
        return;
      }
      var url = signed.data.signedUrl + (signed.data.signedUrl.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
      showPdf(url, fileUpdatedAt(item));
    }).catch(function () {
      showFallbackPdf();
    });
  }

  function uploadPdf(file) {
    showError('');
    if (!file) return;
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf) {
      showError('Yalnızca PDF yükleyin.');
      return;
    }
    if (file.size > MAX_BYTES) {
      showError('Dosya 20 MB’dan büyük olamaz.');
      return;
    }
    var sb = getClient();
    if (!sb) {
      showError('Veritabanı bağlantısı yok.');
      return;
    }
    setBusy(true);
    if (metaEl) metaEl.textContent = 'Yükleniyor…';
    sb.storage.from(BUCKET).upload(OBJECT, file, {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '60'
    }).then(function (res) {
      if (res.error) {
        showError(storageErrorHint(res.error));
        setBusy(false);
        loadStoredPdf();
        return;
      }
      setBusy(false);
      loadStoredPdf();
    }).catch(function (err) {
      showError(storageErrorHint(err));
      setBusy(false);
      loadStoredPdf();
    });
  }

  if (fileEl) {
    fileEl.addEventListener('change', function () {
      var file = fileEl.files && fileEl.files[0];
      fileEl.value = '';
      uploadPdf(file);
    });
  }

  function start() {
    loadStoredPdf();
  }

  if (window.meldusAuth && typeof window.meldusAuth.whenReady === 'function') {
    window.meldusAuth.whenReady(start);
  } else {
    start();
  }
})();
