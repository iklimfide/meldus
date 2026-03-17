(function () {
  'use strict';

  var supabase = null;
  if (typeof window.SUPABASE_URL !== 'undefined' && typeof window.SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
    supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  var modalYeni = document.getElementById('modal-yeni-kayit');
  var btnYeniKayit = document.getElementById('btn-yeni-kayit');
  var yeniCesit = document.getElementById('yeni-cesit');
  var yeniEkim = document.getElementById('yeni-ekim_tarihi');
  var yeniMiktar = document.getElementById('yeni-ekilen_miktar');
  var btnKaydet = document.getElementById('btn-yeni-kayit-onay');
  var cesitDatalist = document.getElementById('yeni-cesit-list');
  var stok = [];
  var hiddenRowIds = {};
  var selectedStokIds = {};
  var quickFilterCesit = '';
  var tableSearchQuery = '';
  var cesitAutocompletePrevLen = 0;
  var stokSortKey = '';
  var stokSortDir = 'asc';

  function formatDate(iso) {
    if (!iso) return '—';
    var s = String(iso).trim().slice(0, 10);
    if (s.length !== 10) return '—';
    return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
  }

  function formatNum(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var s = String(Math.floor(Number(n)));
    var parts = [];
    while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
    if (s) parts.unshift(s);
    return parts.join('.');
  }

  function loadStok() {
    if (!supabase) return;
    supabase.from('fide_stok').select('*').order('ekim_tarihi', { ascending: false }).then(function (res) {
      stok = (res.data && res.data.slice()) || [];
      renderStok();
    });
  }

  function renderStok() {
    var tbody = document.getElementById('stok-tbody');
    if (!tbody) return;
    try { hiddenRowIds = JSON.parse(localStorage.getItem('meldus_hidden_row_ids') || '{}'); } catch (e) {}
    var list = quickFilterCesit ? stok.filter(function (r) { return (r.cesit || '').trim() === quickFilterCesit; }) : stok.slice();
    if (tableSearchQuery) {
      var q = tableSearchQuery.toLowerCase();
      list = list.filter(function (r) {
        var cesitStr = (r.cesit || '').toLowerCase();
        var ekimStr = formatDate(r.ekim_tarihi).toLowerCase();
        var teslimStr = formatDate(r.teslim_tarihi).toLowerCase();
        var miktarStr = formatNum(r.ekilen_miktar).toLowerCase();
        var extraStr = formatNum(r.extra_fide).toLowerCase();
        return cesitStr.indexOf(q) !== -1 || ekimStr.indexOf(q) !== -1 || teslimStr.indexOf(q) !== -1 || miktarStr.indexOf(q) !== -1 || extraStr.indexOf(q) !== -1;
      });
    }
    if (stokSortKey) {
      list.sort(function (a, b) {
        var key = stokSortKey;
        var va = a[key];
        var vb = b[key];
        if (key === 'cesit') {
          va = (va || '').trim();
          vb = (vb || '').trim();
          return stokSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        if (key === 'ekim_tarihi' || key === 'teslim_tarihi') {
          va = (va || '').toString().slice(0, 10);
          vb = (vb || '').toString().slice(0, 10);
          return stokSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        if (key === 'ekilen_miktar' || key === 'extra_fide') {
          va = Number(va);
          vb = Number(vb);
          if (isNaN(va)) va = 0;
          if (isNaN(vb)) vb = 0;
          return stokSortDir === 'asc' ? va - vb : vb - va;
        }
        return 0;
      });
    }
    if (list.length === 0) {
      var emptyMsg = tableSearchQuery ? 'Arama ile eşleşen kayıt yok.' : (quickFilterCesit ? 'Bu çeşitte kayıt yok.' : 'Henüz kayıt yok. Yeni kayıt ekleyin.');
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state px-4 py-8">' + emptyMsg + '</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (r) {
      var id = r.id || '';
      var extraFide = r.extra_fide != null ? Number(r.extra_fide) : 0;
      var hidden = hiddenRowIds[id] || (isNaN(extraFide) ? false : extraFide === 0);
      var sel = selectedStokIds[id];
      return '<tr data-id="' + id + '"' + (hidden ? ' class="row-hidden"' : '') + '>' +
        '<td class="px-4 py-2">' + (r.cesit || '—').replace(/</g, '&lt;') + '</td>' +
        '<td class="px-4 py-2">' + formatDate(r.ekim_tarihi) + '</td>' +
        '<td class="px-4 py-2">' + formatDate(r.teslim_tarihi) + '</td>' +
        '<td class="px-4 py-2">' + formatNum(r.ekilen_miktar) + '</td>' +
        '<td class="px-4 py-2">' + formatNum(r.extra_fide) + '</td>' +
        '<td class="px-4 py-2"><button type="button" class="btn-sat row-act" data-id="' + id + '">Sat</button> <button type="button" class="btn-kime-satildi row-act" data-id="' + id + '">Kime satıldı</button> <button type="button" class="btn-aktar row-act" data-id="' + id + '">Sonrakine aktar</button> <button type="button" class="btn-onceki-aktar row-act" data-id="' + id + '">Öncekine aktar</button> <button type="button" class="btn-cope-at row-act" data-id="' + id + '">Çöpe at</button> <button type="button" class="btn-degistir row-act" data-id="' + id + '">Değiştir</button> <button type="button" class="btn-gizle row-act" data-id="' + id + '">' + (hidden ? 'Göster' : 'Gizle') + '</button> <button type="button" class="btn-sil" data-id="' + id + '">Sil</button></td>' +
        '<td class="px-4 py-2"><input type="checkbox" class="row-select" data-id="' + id + '"' + (sel ? ' checked' : '') + ' aria-label="Seç" /></td></tr>';
    }).join('');

    tbody.querySelectorAll('.btn-gizle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var tr = btn.closest('tr');
        if (hiddenRowIds[id]) {
          delete hiddenRowIds[id];
          if (tr) tr.classList.remove('row-hidden');
        } else {
          hiddenRowIds[id] = true;
          if (tr) tr.classList.add('row-hidden');
        }
        try { localStorage.setItem('meldus_hidden_row_ids', JSON.stringify(hiddenRowIds)); } catch (e) {}
      });
    });
    tbody.querySelectorAll('.row-select').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-id');
        selectedStokIds[id] = cb.checked;
        updateSecilenInfo();
      });
    });

    var selectAll = document.getElementById('stok-select-all');
    if (selectAll) {
      selectAll.onclick = function () {
        var checked = this.checked;
        tbody.querySelectorAll('.row-select').forEach(function (cb) {
          cb.checked = checked;
          selectedStokIds[cb.getAttribute('data-id')] = checked;
        });
        updateSecilenInfo();
      };
    }
    updateSecilenInfo();
  }

  function updateSecilenInfo() {
    var ids = Object.keys(selectedStokIds).filter(function (id) { return selectedStokIds[id]; });
    var n = ids.length;
    var info = document.getElementById('stok-secilen-info');
    var countEl = document.getElementById('stok-secilen-count');
    var btnToplu = document.getElementById('btn-toplu-sil');
    if (info) info.style.display = n ? 'table-footer-group' : 'none';
    if (countEl) countEl.textContent = n;
    if (btnToplu) btnToplu.disabled = n === 0;
  }

  function topluSil() {
    var ids = Object.keys(selectedStokIds).filter(function (id) { return selectedStokIds[id]; });
    if (ids.length === 0) return;
    if (!confirm(ids.length + ' kayıt silinecek. Emin misiniz?')) return;
    if (!supabase) return;
    supabase.from('fide_stok').delete().in('id', ids).then(function (res) {
      if (!res.error) {
        ids.forEach(function (id) { delete selectedStokIds[id]; });
        loadStok();
      } else {
        var msg = (res.error && res.error.message) ? res.error.message : 'Silme yapılamadı.';
        if (/foreign key|violates|referenced|ilişkili/i.test(msg)) {
          alert('Seçili kayıtlar silinemiyor: Satış veya başka ilişkili kayıtlar var. Önce ilgili satışları kaldırmanız gerekebilir.');
        } else {
          alert('Silinemedi: ' + msg);
        }
      }
    });
  }

  function openModalYeniKayit() {
    if (modalYeni) {
      if (yeniEkim) yeniEkim.value = new Date().toISOString().slice(0, 10);
      if (yeniCesit) { yeniCesit.value = ''; cesitAutocompletePrevLen = 0; }
      if (yeniMiktar) yeniMiktar.value = '';
      if (supabase && cesitDatalist) {
        supabase.from('fide_stok').select('cesit').then(function (res) {
          if (res.data && res.data.length) {
            var seen = {};
            var list = [];
            res.data.forEach(function (r) {
              var c = (r.cesit || '').trim();
              if (c && !seen[c]) { seen[c] = true; list.push(c); }
            });
            list.sort();
            cesitDatalist.innerHTML = list.map(function (c) { return '<option value="' + c.replace(/"/g, '&quot;') + '">'; }).join('');
          }
        });
      }
      modalYeni.classList.add('open');
      modalYeni.setAttribute('aria-hidden', 'false');
      if (yeniCesit) yeniCesit.focus();
    }
  }

  function closeModalYeniKayit() {
    if (modalYeni) {
      modalYeni.classList.remove('open');
      modalYeni.setAttribute('aria-hidden', 'true');
    }
  }

  if (btnYeniKayit) btnYeniKayit.addEventListener('click', openModalYeniKayit);

  document.querySelectorAll('[data-modal-close="yeni-kayit"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalYeniKayit);
  });
  if (modalYeni) {
    modalYeni.addEventListener('click', function (e) {
      if (e.target === modalYeni) closeModalYeniKayit();
    });
  }

  if (yeniCesit && cesitDatalist) {
    yeniCesit.addEventListener('input', function () {
      var val = yeniCesit.value;
      if (val.length <= cesitAutocompletePrevLen) { cesitAutocompletePrevLen = val.length; return; }
      cesitAutocompletePrevLen = val.length;
      if (!val) return;
      var opts = [];
      for (var i = 0; i < cesitDatalist.options.length; i++) opts.push(cesitDatalist.options[i].value);
      var valUpper = val.toUpperCase();
      var match = null;
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].toUpperCase().indexOf(valUpper) === 0) { match = opts[j]; break; }
      }
      if (match && match !== val) {
        yeniCesit.value = match;
        yeniCesit.setSelectionRange(val.length, match.length);
        cesitAutocompletePrevLen = match.length;
      }
    });
  }

  function onEnterGoNext(current, next) {
    if (!current || !next) return;
    current.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        next.focus();
      }
    });
  }
  onEnterGoNext(yeniCesit, yeniEkim);
  onEnterGoNext(yeniEkim, yeniMiktar);
  onEnterGoNext(yeniMiktar, btnKaydet);

  function parseMiktar(str) {
    if (str == null || str === '') return null;
    var n = parseInt(String(str).replace(/\D/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  function formatMiktarBinlik(str) {
    var digits = String(str).replace(/\D/g, '');
    if (digits === '') return '';
    var n = digits.length;
    var parts = [];
    while (n > 3) {
      parts.unshift(digits.slice(n - 3, n));
      n -= 3;
    }
    if (n > 0) parts.unshift(digits.slice(0, n));
    return parts.join('.');
  }

  function addDays(isoStr, days) {
    if (!isoStr) return null;
    var d = new Date(String(isoStr).slice(0, 10));
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  if (btnKaydet) {
    btnKaydet.addEventListener('click', function () {
      var cesit = (yeniCesit && yeniCesit.value || '').trim();
      var ekim = (yeniEkim && yeniEkim.value || '').trim() || null;
      var miktar = parseMiktar(yeniMiktar && yeniMiktar.value);
      if (!cesit) return;
      if (miktar === null) miktar = 0;
      var teslim = ekim ? addDays(ekim, 25) : null;
      var extraFide = miktar != null ? Math.round(miktar * 0.95) * 300 : 0;
      if (!supabase) return;
      btnKaydet.disabled = true;
      supabase.from('fide_stok').insert({
        cesit: cesit,
        ekim_tarihi: ekim,
        teslim_tarihi: teslim,
        ekilen_miktar: miktar,
        cikan_fide: 0,
        extra_fide: extraFide
      }).then(function (res) {
        btnKaydet.disabled = false;
        if (res.error) return;
        closeModalYeniKayit();
        loadStok();
      });
    });
  }

  var btnTopluSil = document.getElementById('btn-toplu-sil');
  if (btnTopluSil) {
    btnTopluSil.addEventListener('click', topluSil);
    btnTopluSil.disabled = true;
  }

  var showHiddenEl = document.getElementById('show-hidden-rows');
  var viewStok = document.getElementById('view-stok');
  if (showHiddenEl && viewStok) {
    showHiddenEl.addEventListener('change', function () {
      viewStok.classList.toggle('show-hidden-rows', showHiddenEl.checked);
    });
  }

  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var cesit = (btn.getAttribute('data-cesit') || '').trim();
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      quickFilterCesit = cesit;
      renderStok();
    });
  });

  var searchTableEl = document.getElementById('search-table');
  if (searchTableEl) {
    searchTableEl.addEventListener('input', function () {
      tableSearchQuery = (searchTableEl.value || '').trim();
      renderStok();
    });
  }

  var mainTable = document.getElementById('mainTable');
  if (mainTable) {
    mainTable.querySelectorAll('thead th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (!key) return;
        if (stokSortKey === key) stokSortDir = stokSortDir === 'asc' ? 'desc' : 'asc';
        else { stokSortKey = key; stokSortDir = 'asc'; }
        renderStok();
      });
    });
  }

  function toIsoDate(val) {
    if (!val) return '';
    var s = String(val).trim().slice(0, 10);
    return s.length === 10 ? s : '';
  }

  var modalDegistir = document.getElementById('modal-degistir');
  var degistirCesit = document.getElementById('degistir-cesit');
  var degistirEkim = document.getElementById('degistir-ekim_tarihi');
  var degistirTeslim = document.getElementById('degistir-teslim_tarihi');
  var degistirEkilen = document.getElementById('degistir-ekilen_miktar');
  var degistirExtra = document.getElementById('degistir-extra_fide');
  var degistirCesitList = document.getElementById('degistir-cesit-list');
  var editingStokId = null;

  function openModalDegistir(id) {
    var r = stok.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;
    editingStokId = id;
    if (degistirCesit) degistirCesit.value = r.cesit || '';
    if (degistirEkim) degistirEkim.value = toIsoDate(r.ekim_tarihi);
    if (degistirTeslim) degistirTeslim.value = toIsoDate(r.teslim_tarihi);
    if (degistirEkilen) degistirEkilen.value = r.ekilen_miktar != null && r.ekilen_miktar !== '' ? String(r.ekilen_miktar) : '';
    if (degistirExtra) degistirExtra.value = r.extra_fide != null && r.extra_fide !== '' ? String(r.extra_fide) : '';
    if (supabase && degistirCesitList) {
      supabase.from('fide_stok').select('cesit').then(function (res) {
        if (res.data && res.data.length) {
          var seen = {};
          var list = [];
          res.data.forEach(function (x) {
            var c = (x.cesit || '').trim();
            if (c && !seen[c]) { seen[c] = true; list.push(c); }
          });
          list.sort();
          degistirCesitList.innerHTML = list.map(function (c) { return '<option value="' + c.replace(/"/g, '&quot;') + '">'; }).join('');
        }
      });
    }
    if (modalDegistir) {
      modalDegistir.classList.add('open');
      modalDegistir.setAttribute('aria-hidden', 'false');
      if (degistirCesit) degistirCesit.focus();
    }
  }

  function closeModalDegistir() {
    editingStokId = null;
    if (modalDegistir) {
      modalDegistir.classList.remove('open');
      modalDegistir.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="degistir"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalDegistir);
  });
  if (modalDegistir) {
    modalDegistir.addEventListener('click', function (e) {
      if (e.target === modalDegistir) closeModalDegistir();
    });
  }

  var modalSat = document.getElementById('modal-sat');
  var satMusteri = document.getElementById('sat-musteri');
  var satTeslimTarihi = document.getElementById('sat-teslim-tarihi');
  var satMiktar = document.getElementById('sat-miktar');
  var satNotlar = document.getElementById('sat-notlar');
  var satStokId = null;

  function openModalSat(id) {
    satStokId = id;
    if (satMusteri) satMusteri.value = '';
    if (satTeslimTarihi) {
      var d = new Date();
      satTeslimTarihi.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    if (satMiktar) satMiktar.value = '';
    if (satNotlar) satNotlar.value = '';
    if (modalSat) {
      modalSat.classList.add('open');
      modalSat.setAttribute('aria-hidden', 'false');
      if (satMusteri) satMusteri.focus();
    }
  }

  function closeModalSat() {
    satStokId = null;
    if (modalSat) {
      modalSat.classList.remove('open');
      modalSat.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="sat"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSat);
  });
  if (modalSat) {
    modalSat.addEventListener('click', function (e) {
      if (e.target === modalSat) closeModalSat();
    });
  }
  onEnterGoNext(satMusteri, satTeslimTarihi);
  onEnterGoNext(satTeslimTarihi, satMiktar);
  onEnterGoNext(satMiktar, satNotlar);
  onEnterGoNext(satNotlar, document.getElementById('btn-sat-onay'));
  if (satMiktar) {
    satMiktar.addEventListener('input', function () {
      this.value = formatMiktarBinlik(this.value);
    });
  }
  var btnSatOnay = document.getElementById('btn-sat-onay');
  if (btnSatOnay) {
    btnSatOnay.addEventListener('click', function () {
      if (!satStokId || !supabase) { closeModalSat(); return; }
      var musteri = (satMusteri && satMusteri.value || '').trim() || null;
      var teslimTarihi = (satTeslimTarihi && satTeslimTarihi.value || '').trim() || null;
      var miktar = parseMiktar(satMiktar && satMiktar.value);
      if (miktar === null || miktar < 1) { alert('Kaç adet 1 veya daha fazla olmalıdır.'); return; }
      var notlar = (satNotlar && satNotlar.value || '').trim() || null;
      // notlar kolonu yoksa: ALTER TABLE satislar ADD COLUMN notlar text;
      supabase.from('satislar').insert({
        fide_id: satStokId,
        musteri_adi: musteri || '',
        teslim_tarihi: teslimTarihi || null,
        miktar: miktar,
        satis_tarihi: new Date().toISOString(),
        notlar: notlar
    }).then(function (res) {
        if (res.error) return;
        supabase.from('fide_stok').select('extra_fide').eq('id', satStokId).maybeSingle().then(function (r) {
          var extra = (r.data && r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
          supabase.from('fide_stok').update({ extra_fide: extra - miktar }).eq('id', satStokId).then(function () {
            closeModalSat();
            loadStok();
          });
        });
      });
    });
  }

  var btnDegistirOnay = document.getElementById('btn-degistir-onay');
  if (btnDegistirOnay) {
    btnDegistirOnay.addEventListener('click', function () {
      if (!editingStokId || !supabase) return;
      var cesit = (degistirCesit && degistirCesit.value || '').trim();
      var ekim = (degistirEkim && degistirEkim.value || '').trim() || null;
      var teslim = (degistirTeslim && degistirTeslim.value || '').trim() || null;
      var ekilen = parseMiktar(degistirEkilen && degistirEkilen.value);
      var extra = parseMiktar(degistirExtra && degistirExtra.value);
      if (ekilen === null) ekilen = 0;
      if (extra === null) extra = 0;
      supabase.from('fide_stok').update({
        cesit: cesit || null,
        ekim_tarihi: ekim,
        teslim_tarihi: teslim,
        ekilen_miktar: ekilen,
        extra_fide: extra
      }).eq('id', editingStokId).then(function (res) {
        if (!res.error) {
          closeModalDegistir();
          loadStok();
        }
      });
    });
  }

  var modalKimeSatildi = document.getElementById('modal-kime-satildi');
  var modalKimeSatildiTitle = document.getElementById('modal-kime-satildi-title');
  var modalKimeSatildiEkim = document.getElementById('modal-kime-satildi-ekim');
  var modalKimeSatildiBody = document.getElementById('modal-kime-satildi-body');
  var modalKimeSatildiToplam = document.getElementById('modal-kime-satildi-toplam');
  var kimeSatildiFideId = null;

  var modalTeslim = document.getElementById('modal-teslim');
  var modalTeslimTbody = document.getElementById('modal-teslim-tbody');
  var modalTeslimEdilenler = document.getElementById('modal-teslim-edilenler');
  var modalTeslimEdilenlerTbody = document.getElementById('modal-teslim-edilenler-tbody');
  var teslimDisplayRows = [];
  var teslimEdilenlerDisplayRows = [];

  function fillTeslimFilterSelects() {
    var uniq = function (arr) { var s = {}; arr.forEach(function (v) { s[v] = true; }); return Object.keys(s).sort(); };
    var tarih = uniq(teslimDisplayRows.map(function (r) { return r.tarih; }));
    var musteri = uniq(teslimDisplayRows.map(function (r) { return r.musteri; }));
    var ekim = uniq(teslimDisplayRows.map(function (r) { return r.ekimStr; }));
    var teslim = uniq(teslimDisplayRows.map(function (r) { return r.teslim; }));
    var adet = uniq(teslimDisplayRows.map(function (r) { return r.miktarNum; }));
    function setOptions(id, values) {
      var sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">Tümü</option>';
      values.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
    }
    setOptions('teslim-filter-tarih', tarih);
    setOptions('teslim-filter-musteri', musteri);
    setOptions('teslim-filter-ekim', ekim);
    setOptions('teslim-filter-teslim', teslim);
    setOptions('teslim-filter-adet', adet);
  }

  function fillTeslimEdilenlerFilterSelects() {
    var uniq = function (arr) { var s = {}; arr.forEach(function (v) { s[v] = true; }); return Object.keys(s).sort(); };
    var tarih = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.tarih; }));
    var musteri = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.musteri; }));
    var ekim = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.ekimStr; }));
    var teslim = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.teslim; }));
    var adet = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.miktarNum; }));
    function setOptions(id, values) {
      var sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">Tümü</option>';
      values.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
    }
    setOptions('teslim-edilenler-filter-tarih', tarih);
    setOptions('teslim-edilenler-filter-musteri', musteri);
    setOptions('teslim-edilenler-filter-ekim', ekim);
    setOptions('teslim-edilenler-filter-teslim', teslim);
    setOptions('teslim-edilenler-filter-adet', adet);
  }

  function renderTeslimTable() {
    var fTarih = (document.getElementById('teslim-filter-tarih') || {}).value || '';
    var fMusteri = (document.getElementById('teslim-filter-musteri') || {}).value || '';
    var fEkim = (document.getElementById('teslim-filter-ekim') || {}).value || '';
    var fTeslim = (document.getElementById('teslim-filter-teslim') || {}).value || '';
    var fAdet = (document.getElementById('teslim-filter-adet') || {}).value || '';
    var filtered = teslimDisplayRows.filter(function (r) {
      return (fTarih === '' || r.tarih === fTarih) && (fMusteri === '' || r.musteri === fMusteri) && (fEkim === '' || r.ekimStr === fEkim) && (fTeslim === '' || r.teslim === fTeslim) && (fAdet === '' || r.miktarNum === fAdet);
    });
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var rows = filtered.map(function (r) {
      var sid = (r.satisId || '');
      return '<tr data-satis-id="' + sid + '"><td class="px-4 py-2">' + esc(r.tarih) + '</td><td class="px-4 py-2">' + esc(r.musteri) + '</td><td class="px-4 py-2">' + esc(r.ekimStr) + '</td><td class="px-4 py-2">' + esc(r.teslim) + '</td><td class="px-4 py-2">' + esc(r.miktarNum) + '</td><td class="px-4 py-2">' + esc(r.notStr || '—') + '</td><td class="px-4 py-2"><button type="button" class="btn-teslim-et" data-satis-id="' + sid + '">Teslim et</button></td></tr>';
    });
    if (modalTeslimTbody) modalTeslimTbody.innerHTML = rows.join('');
    var toplam = filtered.reduce(function (sum, r) { return sum + (r.miktarRaw || 0); }, 0);
    var toplamEl = document.getElementById('modal-teslim-toplam');
    if (toplamEl) toplamEl.textContent = formatNum(toplam);
  }

  function renderTeslimEdilenlerTable() {
    var fTarih = (document.getElementById('teslim-edilenler-filter-tarih') || {}).value || '';
    var fMusteri = (document.getElementById('teslim-edilenler-filter-musteri') || {}).value || '';
    var fEkim = (document.getElementById('teslim-edilenler-filter-ekim') || {}).value || '';
    var fTeslim = (document.getElementById('teslim-edilenler-filter-teslim') || {}).value || '';
    var fAdet = (document.getElementById('teslim-edilenler-filter-adet') || {}).value || '';
    var filtered = teslimEdilenlerDisplayRows.filter(function (r) {
      return (fTarih === '' || r.tarih === fTarih) && (fMusteri === '' || r.musteri === fMusteri) && (fEkim === '' || r.ekimStr === fEkim) && (fTeslim === '' || r.teslim === fTeslim) && (fAdet === '' || r.miktarNum === fAdet);
    });
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var rows = filtered.map(function (r) {
      var sid = (r.satisId || '');
      return '<tr data-satis-id="' + sid + '"><td class="px-4 py-2">' + esc(r.tarih) + '</td><td class="px-4 py-2">' + esc(r.musteri) + '</td><td class="px-4 py-2">' + esc(r.ekimStr) + '</td><td class="px-4 py-2">' + esc(r.teslim) + '</td><td class="px-4 py-2">' + esc(r.miktarNum) + '</td><td class="px-4 py-2"><button type="button" class="btn-teslim-geri-al" data-satis-id="' + sid + '">Geri al</button></td></tr>';
    });
    if (modalTeslimEdilenlerTbody) modalTeslimEdilenlerTbody.innerHTML = rows.join('');
    var toplam = filtered.reduce(function (sum, r) { return sum + (r.miktarRaw || 0); }, 0);
    var toplamEl = document.getElementById('modal-teslim-edilenler-toplam');
    if (toplamEl) toplamEl.textContent = formatNum(toplam);
  }

  function openModalKimeSatildi(fideId) {
    kimeSatildiFideId = fideId;
    var r = stok.find(function (x) { return String(x.id) === String(fideId); });
    var cesitAd = r ? (r.cesit || 'Stok') : 'Stok';
    if (modalKimeSatildiTitle) modalKimeSatildiTitle.textContent = 'Kime satıldı – ' + cesitAd;
    if (modalKimeSatildiEkim) modalKimeSatildiEkim.textContent = r && r.ekim_tarihi ? 'Ekim tarihi: ' + formatDate(r.ekim_tarihi) : '';
    if (!supabase || !modalKimeSatildiBody) return;
    supabase.from('satislar').select('*').eq('fide_id', fideId).order('satis_tarihi', { ascending: false }).then(function (res) {
      var list = (res.data && res.data.slice()) || [];
      var toplam = 0;
      var ekimStr = r && r.ekim_tarihi ? formatDate(r.ekim_tarihi) : '—';
      var rows = list.map(function (s) {
        var displayMiktar = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : (s.miktar != null ? Number(s.miktar) : 0);
        if (isNaN(displayMiktar)) displayMiktar = 0;
        toplam += displayMiktar;
        var tarih = formatDate(s.satis_tarihi);
        var teslim = formatDate(s.teslim_tarihi);
        var musteri = (s.musteri_adi || '—').replace(/</g, '&lt;');
        var notStr = (s.notlar || '—').replace(/</g, '&lt;');
        return '<tr data-satis-id="' + (s.id || '') + '"><td class="px-4 py-2">' + tarih + '</td><td class="px-4 py-2">' + musteri + '</td><td class="px-4 py-2">' + ekimStr + '</td><td class="px-4 py-2">' + teslim + '</td><td class="px-4 py-2">' + formatNum(displayMiktar) + '</td><td class="px-4 py-2">' + notStr + '</td><td class="px-4 py-2"><button type="button" class="btn-satis-iptal" data-satis-id="' + (s.id || '') + '">Satış iptal</button> <button type="button" class="btn-satis-degistir" data-satis-id="' + (s.id || '') + '">Değiştir</button> <button type="button" class="btn-satis-aktar" data-satis-id="' + (s.id || '') + '">Satışı aktar</button></td></tr>';
      });
      var toplamRow = '<tfoot><tr><td colspan="4" class="px-4 py-2">Toplam</td><td class="px-4 py-2">' + formatNum(toplam) + '</td><td></td><td></td></tr></tfoot>';
      var html = '<table class="panel-table"><thead><tr><th>Tarih</th><th>Müşteri</th><th>Ekim Tarihi</th><th>Teslim Tarihi</th><th>Adet</th><th>Not</th><th>İşlemler</th></tr></thead><tbody>' + rows.join('') + '</tbody>' + toplamRow + '</table>';
      modalKimeSatildiBody.innerHTML = list.length ? html : '<p style="padding:1rem;">Henüz satış kaydı yok.</p>';
      if (modalKimeSatildi) {
        modalKimeSatildi.classList.add('open');
        modalKimeSatildi.setAttribute('aria-hidden', 'false');
      }
    });
  }

  function refreshKimeSatildiList() {
    if (kimeSatildiFideId) openModalKimeSatildi(kimeSatildiFideId);
  }

  function closeModalKimeSatildi() {
    kimeSatildiFideId = null;
    if (modalKimeSatildi) {
      modalKimeSatildi.classList.remove('open');
      modalKimeSatildi.setAttribute('aria-hidden', 'true');
    }
  }

  function openModalTeslim() {
    if (modalTeslimTbody) modalTeslimTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Yükleniyor...</td></tr>';
    var toplamEl = document.getElementById('modal-teslim-toplam');
    if (toplamEl) toplamEl.textContent = '0';
    if (modalTeslim) {
      modalTeslim.classList.add('open');
      modalTeslim.setAttribute('aria-hidden', 'false');
    }
    if (!supabase || !modalTeslimTbody) {
      if (modalTeslimTbody) modalTeslimTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Bağlantı yok.</td></tr>';
      return;
    }
    supabase.from('satislar').select('*').order('teslim_tarihi', { ascending: true }).then(function (res) {
      var list = (res.data && res.data.slice()) || [];
      list = list.filter(function (s) { return !s.teslim_edildi_tarihi; });
      if (list.length === 0) {
        teslimDisplayRows = [];
        modalTeslimTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Henüz teslim edilecek kayıt yok.</td></tr>';
        if (toplamEl) toplamEl.textContent = '0';
        return;
      }
      var fideIds = [];
      var seen = {};
      list.forEach(function (s) {
        var fid = s.fide_id;
        if (fid != null && !seen[fid]) { seen[fid] = true; fideIds.push(fid); }
      });
      function fillTeslimDisplay(list, stokMap) {
        var miktarRaw = function (s) { var n = s.miktar != null ? Number(s.miktar) : 0; return isNaN(n) ? 0 : n; };
        teslimDisplayRows = list.map(function (s) {
          var tarih = formatDate(s.satis_tarihi);
          var musteri = (s.musteri_adi || '—').replace(/</g, '&lt;');
          var stokRow = stokMap ? stokMap[s.fide_id] : null;
          var ekimStr = stokRow && stokRow.ekim_tarihi ? formatDate(stokRow.ekim_tarihi) : '—';
          var teslim = formatDate(s.teslim_tarihi);
          var miktar = miktarRaw(s);
          var notStr = (s.notlar || '—').replace(/</g, '&lt;');
          return { tarih: tarih, musteri: musteri, ekimStr: ekimStr, teslim: teslim, miktarNum: formatNum(s.miktar), miktarRaw: miktar, satisId: s.id || '', notStr: notStr };
        });
        fillTeslimFilterSelects();
        renderTeslimTable();
      }
      if (fideIds.length === 0) {
        fillTeslimDisplay(list, {});
        return;
      }
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').in('id', fideIds).then(function (r2) {
        var stokMap = {};
        (r2.data || []).forEach(function (row) {
          stokMap[row.id] = { cesit: (row.cesit || '—').replace(/</g, '&lt;'), ekim_tarihi: row.ekim_tarihi };
        });
        fillTeslimDisplay(list, stokMap);
      });
    });
  }

  function closeModalTeslim() {
    if (modalTeslim) {
      modalTeslim.classList.remove('open');
      modalTeslim.setAttribute('aria-hidden', 'true');
    }
  }

  function openModalTeslimEdilenler() {
    if (modalTeslimEdilenlerTbody) modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="6" class="px-4 py-2">Yükleniyor...</td></tr>';
    var toplamElEdilenler = document.getElementById('modal-teslim-edilenler-toplam');
    if (toplamElEdilenler) toplamElEdilenler.textContent = '0';
    if (modalTeslimEdilenler) {
      modalTeslimEdilenler.classList.add('open');
      modalTeslimEdilenler.setAttribute('aria-hidden', 'false');
    }
    if (!supabase || !modalTeslimEdilenlerTbody) {
      if (modalTeslimEdilenlerTbody) modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="6" class="px-4 py-2">Bağlantı yok.</td></tr>';
      return;
    }
    supabase.from('satislar').select('*').order('teslim_edildi_tarihi', { ascending: false }).then(function (res) {
      var list = (res.data && res.data.slice()) || [];
      list = list.filter(function (s) { return s.teslim_edildi_tarihi; });
      if (list.length === 0) {
        teslimEdilenlerDisplayRows = [];
        modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="6" class="px-4 py-2">Henüz teslim edilen kayıt yok.</td></tr>';
        if (toplamElEdilenler) toplamElEdilenler.textContent = '0';
        return;
      }
      var fideIds = [];
      var seen = {};
      list.forEach(function (s) {
        var fid = s.fide_id;
        if (fid != null && !seen[fid]) { seen[fid] = true; fideIds.push(fid); }
      });
      function fillTeslimEdilenlerDisplay(list, stokMap) {
        var miktarRaw = function (s) { var n = s.miktar != null ? Number(s.miktar) : 0; return isNaN(n) ? 0 : n; };
        teslimEdilenlerDisplayRows = list.map(function (s) {
          var tarih = formatDate(s.satis_tarihi);
          var musteri = (s.musteri_adi || '—').replace(/</g, '&lt;');
          var stokRow = stokMap ? stokMap[s.fide_id] : null;
          var ekimStr = stokRow && stokRow.ekim_tarihi ? formatDate(stokRow.ekim_tarihi) : '—';
          var teslim = formatDate(s.teslim_tarihi);
          var displayMiktar = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : miktarRaw(s);
          if (isNaN(displayMiktar)) displayMiktar = miktarRaw(s);
          return { tarih: tarih, musteri: musteri, ekimStr: ekimStr, teslim: teslim, miktarNum: formatNum(displayMiktar), miktarRaw: displayMiktar, satisId: s.id || '' };
        });
        fillTeslimEdilenlerFilterSelects();
        renderTeslimEdilenlerTable();
      }
      if (fideIds.length === 0) {
        fillTeslimEdilenlerDisplay(list, {});
        return;
      }
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').in('id', fideIds).then(function (r2) {
        var stokMap = {};
        (r2.data || []).forEach(function (row) {
          stokMap[row.id] = { cesit: (row.cesit || '—').replace(/</g, '&lt;'), ekim_tarihi: row.ekim_tarihi };
        });
        fillTeslimEdilenlerDisplay(list, stokMap);
      });
    });
  }

  function closeModalTeslimEdilenler() {
    if (modalTeslimEdilenler) {
      modalTeslimEdilenler.classList.remove('open');
      modalTeslimEdilenler.setAttribute('aria-hidden', 'true');
    }
  }

  var btnTeslimFixed = document.getElementById('btn-teslim-fixed');
  if (btnTeslimFixed) btnTeslimFixed.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openModalTeslim(); });
  var btnTeslimEdilenlerFixed = document.getElementById('btn-teslim-edilenler-fixed');
  if (btnTeslimEdilenlerFixed) btnTeslimEdilenlerFixed.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openModalTeslimEdilenler(); });

  var modalTeslimAdet = document.getElementById('modal-teslim-adet');
  var teslimAdetMiktarInput = document.getElementById('teslim-adet-miktar');
  var teslimAdetSatisId = null;

  function openModalTeslimAdet(satisId, adetStr) {
    teslimAdetSatisId = satisId;
    if (teslimAdetMiktarInput) {
      teslimAdetMiktarInput.value = adetStr || '';
      teslimAdetMiktarInput.placeholder = adetStr ? 'örn. ' + adetStr : 'örn. 10.000';
    }
    if (modalTeslimAdet) {
      modalTeslimAdet.classList.add('open');
      modalTeslimAdet.setAttribute('aria-hidden', 'false');
    }
  }

  function closeModalTeslimAdet() {
    teslimAdetSatisId = null;
    if (teslimAdetMiktarInput) teslimAdetMiktarInput.value = '';
    if (modalTeslimAdet) {
      modalTeslimAdet.classList.remove('open');
      modalTeslimAdet.setAttribute('aria-hidden', 'true');
    }
  }

  if (modalTeslimTbody) {
    modalTeslimTbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-teslim-et');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var satisId = (btn.getAttribute('data-satis-id') || '').trim();
      if (!satisId) return;
      var tr = btn.closest('tr');
      var adetStr = '';
      if (tr && tr.cells && tr.cells[4]) adetStr = (tr.cells[4].textContent || '').trim();
      openModalTeslimAdet(satisId, adetStr);
    });
  }

  document.querySelectorAll('[data-modal-close="teslim-adet"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslimAdet);
  });
  if (modalTeslimAdet) {
    modalTeslimAdet.addEventListener('click', function (e) {
      if (e.target === modalTeslimAdet) closeModalTeslimAdet();
    });
  }
  var btnTeslimAdetOnay = document.getElementById('btn-teslim-adet-onay');
  if (btnTeslimAdetOnay) {
    btnTeslimAdetOnay.addEventListener('click', function () {
      if (!teslimAdetSatisId || !supabase) return;
      var satisId = teslimAdetSatisId;
      var enteredStr = (teslimAdetMiktarInput && teslimAdetMiktarInput.value) ? String(teslimAdetMiktarInput.value).trim() : '';
      var enteredAmount = enteredStr === '' ? NaN : parseInt(enteredStr.replace(/\s/g, ''), 10);
      if (isNaN(enteredAmount) || enteredAmount < 0) enteredAmount = null;
      closeModalTeslimAdet();
      supabase.from('satislar').select('fide_id, miktar').eq('id', satisId).maybeSingle().then(function (res) {
        var s = res.data;
        if (!s || s.fide_id == null) {
          var payload0 = { teslim_edildi_tarihi: new Date().toISOString() };
          if (enteredAmount != null) payload0.teslim_edilen_miktar = enteredAmount;
          supabase.from('satislar').update(payload0).eq('id', satisId).then(function (r) {
            if (r.error) { alert('Güncellenemedi: ' + (r.error.message || '')); return; }
            loadStok();
            openModalTeslim();
          });
          return;
        }
        var saleMiktar = s.miktar != null ? Number(s.miktar) : 0;
        if (isNaN(saleMiktar)) saleMiktar = 0;
        var teslimMiktar = enteredAmount != null ? enteredAmount : saleMiktar;
        var diff = saleMiktar - teslimMiktar;
        function doSatisUpdate() {
          var payload = { teslim_edildi_tarihi: new Date().toISOString() };
          if (enteredAmount != null) payload.teslim_edilen_miktar = enteredAmount;
          supabase.from('satislar').update(payload).eq('id', satisId).then(function (r) {
            if (r.error) { alert('Güncellenemedi: ' + (r.error.message || '')); return; }
            loadStok();
            openModalTeslim();
          });
        }
        if (diff === 0) {
          doSatisUpdate();
          return;
        }
        supabase.from('fide_stok').select('extra_fide').eq('id', s.fide_id).maybeSingle().then(function (r2) {
          var extra = (r2.data && r2.data.extra_fide != null) ? Number(r2.data.extra_fide) : 0;
          if (isNaN(extra)) extra = 0;
          var newExtra = extra + diff;
          if (newExtra < 0) newExtra = 0;
          supabase.from('fide_stok').update({ extra_fide: newExtra }).eq('id', s.fide_id).then(function (r3) {
            if (r3.error) { alert('Stok güncellenemedi: ' + (r3.error.message || '')); return; }
            doSatisUpdate();
          });
        });
      });
    });
  }

  document.querySelectorAll('[data-modal-close="teslim"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslim);
  });
  if (modalTeslim) {
    modalTeslim.addEventListener('click', function (e) {
      if (e.target === modalTeslim) closeModalTeslim();
    });
  }
  if (modalTeslimEdilenlerTbody) {
    modalTeslimEdilenlerTbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-teslim-geri-al');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var satisId = (btn.getAttribute('data-satis-id') || '').trim();
      if (!satisId || !supabase) return;
      supabase.from('satislar').update({ teslim_edildi_tarihi: null }).eq('id', satisId).then(function (r) {
        if (r.error) {
          alert('Güncellenemedi: ' + (r.error.message || ''));
          return;
        }
        openModalTeslimEdilenler();
      });
    });
  }
  document.querySelectorAll('[data-modal-close="teslim-edilenler"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslimEdilenler);
  });
  if (modalTeslimEdilenler) {
    modalTeslimEdilenler.addEventListener('click', function (e) {
      if (e.target === modalTeslimEdilenler) closeModalTeslimEdilenler();
    });
  }

  ['teslim-filter-tarih', 'teslim-filter-musteri', 'teslim-filter-ekim', 'teslim-filter-teslim', 'teslim-filter-adet'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', renderTeslimTable);
  });
  ['teslim-edilenler-filter-tarih', 'teslim-edilenler-filter-musteri', 'teslim-edilenler-filter-ekim', 'teslim-edilenler-filter-teslim', 'teslim-edilenler-filter-adet'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', renderTeslimEdilenlerTable);
  });

  document.querySelectorAll('[data-modal-close="kime-satildi"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalKimeSatildi);
  });
  if (modalKimeSatildi) {
    modalKimeSatildi.addEventListener('click', function (e) {
      if (e.target === modalKimeSatildi) closeModalKimeSatildi();
    });
  }

  if (modalKimeSatildiBody) {
    modalKimeSatildiBody.addEventListener('click', function (e) {
      var iptalBtn = e.target.closest('.btn-satis-iptal');
      if (iptalBtn) {
        var satisId = (iptalBtn.getAttribute('data-satis-id') || '').trim();
        if (!satisId || !confirm('Bu satışı iptal etmek istediğinize emin misiniz?')) return;
        if (!supabase) return;
        supabase.from('satislar').select('fide_id, miktar').eq('id', satisId).maybeSingle().then(function (res) {
          var fideId = (res.data && res.data.fide_id) ? res.data.fide_id : null;
          var miktar = (res.data && res.data.miktar != null) ? Number(res.data.miktar) : 0;
          supabase.from('satislar').delete().eq('id', satisId).then(function (del) {
            if (del.error) {
              alert('Satış kaydı silinemedi: ' + (del.error.message || 'Yetki hatası olabilir.'));
      return;
    }
            refreshKimeSatildiList();
            loadStok();
            if (fideId && miktar > 0) {
              supabase.from('fide_stok').select('extra_fide').eq('id', fideId).maybeSingle().then(function (r2) {
                var extra = (r2.data && r2.data.extra_fide != null ? Number(r2.data.extra_fide) : 0);
                supabase.from('fide_stok').update({ extra_fide: extra + miktar }).eq('id', fideId).then(function () { loadStok(); });
              });
            }
          });
        });
        return;
      }
      var degistirBtn = e.target.closest('.btn-satis-degistir');
      if (degistirBtn) {
        var satisId = degistirBtn.getAttribute('data-satis-id');
        if (satisId) openModalSatisDegistir(satisId);
        return;
      }
      var aktarBtn = e.target.closest('.btn-satis-aktar');
      if (aktarBtn) {
        var satisId = aktarBtn.getAttribute('data-satis-id');
        if (satisId) openModalSatisAktar(satisId);
      }
    });
  }

  var modalSatisAktar = document.getElementById('modal-satis-aktar');
  var satisAktarHedefEkim = document.getElementById('satis-aktar-hedef-ekim');
  var aktarSatisId = null;
  var aktarFideId = null;
  var aktarMiktar = 0;
  var aktarCesit = '';

  function openModalSatisAktar(satisId) {
    if (!supabase || !satisId) return;
    aktarSatisId = satisId;
    if (satisAktarHedefEkim) {
      satisAktarHedefEkim.innerHTML = '<option value="">Seçin...</option>';
      satisAktarHedefEkim.value = '';
    }
    supabase.from('satislar').select('fide_id, miktar').eq('id', satisId).maybeSingle().then(function (res) {
      var s = res.data;
      if (!s || !s.fide_id) return;
      aktarFideId = s.fide_id;
      aktarMiktar = (s.miktar != null ? Number(s.miktar) : 0);
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').eq('id', s.fide_id).maybeSingle().then(function (r2) {
        aktarCesit = (r2.data && r2.data.cesit) ? String(r2.data.cesit) : '';
        var currentEkim = (r2.data && r2.data.ekim_tarihi) ? toIsoDate(r2.data.ekim_tarihi) : '';
        supabase.from('fide_stok').select('id, ekim_tarihi, extra_fide').eq('cesit', aktarCesit).gt('extra_fide', 0).then(function (r3) {
          var rows = (r3.data && r3.data.length) ? r3.data : [];
          var seen = {};
          var dates = [];
          rows.forEach(function (row) {
            if (row.id === aktarFideId) return;
            var ekim = row.ekim_tarihi ? toIsoDate(row.ekim_tarihi) : '';
            if (ekim && !seen[ekim]) { seen[ekim] = true; dates.push(ekim); }
          });
          dates.sort();
          if (satisAktarHedefEkim) {
            satisAktarHedefEkim.innerHTML = '<option value="">Seçin...</option>';
            dates.forEach(function (ekim) {
              var opt = document.createElement('option');
              opt.value = ekim;
              opt.textContent = formatDate(ekim);
              satisAktarHedefEkim.appendChild(opt);
            });
          }
          if (modalSatisAktar) {
            modalSatisAktar.classList.add('open');
            modalSatisAktar.setAttribute('aria-hidden', 'false');
            if (satisAktarHedefEkim) satisAktarHedefEkim.focus();
          }
        });
      });
    });
  }

  function closeModalSatisAktar() {
    aktarSatisId = null;
    aktarFideId = null;
    aktarMiktar = 0;
    aktarCesit = '';
    if (modalSatisAktar) {
      modalSatisAktar.classList.remove('open');
      modalSatisAktar.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="satis-aktar"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSatisAktar);
  });
  if (modalSatisAktar) {
    modalSatisAktar.addEventListener('click', function (e) {
      if (e.target === modalSatisAktar) closeModalSatisAktar();
    });
  }

  var btnSatisAktarOnay = document.getElementById('btn-satis-aktar-onay');
  if (btnSatisAktarOnay) {
    btnSatisAktarOnay.addEventListener('click', function () {
      if (!aktarSatisId || !aktarFideId || !supabase) return;
      var hedefEkim = (satisAktarHedefEkim && satisAktarHedefEkim.value || '').trim();
      if (!hedefEkim) { alert('Hedef ekim tarihi seçin.'); return; }
      supabase.from('fide_stok').select('id, extra_fide').eq('ekim_tarihi', hedefEkim).eq('cesit', aktarCesit).limit(1).then(function (rNew) {
        var newRows = rNew.data && rNew.data.length ? rNew.data : [];
        var newStok = newRows[0];
        if (!newStok) {
          alert('Bu ekim tarihine ait stok kaydı bulunamadı.');
          return;
        }
        if (newStok.id === aktarFideId) {
          alert('Satış zaten bu gruba ait.');
          return;
        }
        var newExtra = (newStok.extra_fide != null ? Number(newStok.extra_fide) : 0);
        if (newExtra < aktarMiktar) {
          alert('Hedef stokta yeterli extra fide yok (' + newExtra + ').');
          return;
        }
        supabase.from('fide_stok').select('extra_fide').eq('id', aktarFideId).maybeSingle().then(function (rOld) {
          var oldExtra = (rOld.data && rOld.data.extra_fide != null ? Number(rOld.data.extra_fide) : 0);
          var miktar = aktarMiktar;
          supabase.from('fide_stok').update({ extra_fide: oldExtra + miktar }).eq('id', aktarFideId).then(function (a) {
            if (a.error) return;
            supabase.from('fide_stok').update({ extra_fide: newExtra - miktar }).eq('id', newStok.id).then(function (b) {
              if (b.error) return;
              supabase.from('satislar').update({ fide_id: newStok.id }).eq('id', aktarSatisId).then(function (c) {
                if (!c.error) {
                  closeModalSatisAktar();
                  refreshKimeSatildiList();
                  loadStok();
                }
              });
            });
          });
        });
      });
    });
  }

  var satisDegistirModal = document.getElementById('modal-satis-degistir');
  var satisDegistirMusteri = document.getElementById('satis-degistir-musteri');
  var satisDegistirTeslim = document.getElementById('satis-degistir-teslim');
  var satisDegistirMiktar = document.getElementById('satis-degistir-miktar');
  var satisDegistirNotlar = document.getElementById('satis-degistir-notlar');
  var editingSatisId = null;

  function openModalSatisDegistir(satisId) {
    if (!supabase || !satisId) return;
    editingSatisId = satisId;
    supabase.from('satislar').select('*').eq('id', satisId).single().then(function (res) {
      var s = res.data;
      if (!s) return;
      if (satisDegistirMusteri) satisDegistirMusteri.value = s.musteri_adi || '';
      if (satisDegistirTeslim) satisDegistirTeslim.value = toIsoDate(s.teslim_tarihi);
      if (satisDegistirMiktar) satisDegistirMiktar.value = s.miktar != null ? String(s.miktar) : '';
      if (satisDegistirNotlar) satisDegistirNotlar.value = s.notlar || '';
      if (satisDegistirModal) {
        satisDegistirModal.classList.add('open');
        satisDegistirModal.setAttribute('aria-hidden', 'false');
        if (satisDegistirMusteri) satisDegistirMusteri.focus();
      }
    });
  }

  function closeModalSatisDegistir() {
    editingSatisId = null;
    if (satisDegistirModal) {
      satisDegistirModal.classList.remove('open');
      satisDegistirModal.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="satis-degistir"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSatisDegistir);
  });
  if (satisDegistirModal) {
    satisDegistirModal.addEventListener('click', function (e) {
      if (e.target === satisDegistirModal) closeModalSatisDegistir();
    });
  }

  var btnSatisDegistirOnay = document.getElementById('btn-satis-degistir-onay');
  if (btnSatisDegistirOnay) {
    btnSatisDegistirOnay.addEventListener('click', function () {
      if (!editingSatisId || !supabase) return;
      var musteri = (satisDegistirMusteri && satisDegistirMusteri.value || '').trim() || null;
      var teslim = (satisDegistirTeslim && satisDegistirTeslim.value || '').trim() || null;
      var miktar = parseMiktar(satisDegistirMiktar && satisDegistirMiktar.value);
      if (miktar === null || miktar < 1) { alert('Kaç adet 1 veya daha fazla olmalıdır.'); return; }
      var notlar = (satisDegistirNotlar && satisDegistirNotlar.value || '').trim() || null;
      supabase.from('satislar').update({
        musteri_adi: musteri || '',
        teslim_tarihi: teslim || null,
        miktar: miktar,
        notlar: notlar
      }).eq('id', editingSatisId).then(function (res) {
        if (!res.error) {
          closeModalSatisDegistir();
          refreshKimeSatildiList();
          loadStok();
        }
      });
    });
  }

  var sonrakineAktarPendingId = null;
  var modalSonrakineAktarOnay = document.getElementById('modal-sonrakine-aktar-onay');

  function closeModalSonrakineAktarOnay() {
    sonrakineAktarPendingId = null;
    if (modalSonrakineAktarOnay) {
      modalSonrakineAktarOnay.classList.remove('open');
      modalSonrakineAktarOnay.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="sonrakine-aktar-onay"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSonrakineAktarOnay);
  });
  if (modalSonrakineAktarOnay) {
    modalSonrakineAktarOnay.addEventListener('click', function (e) {
      if (e.target === modalSonrakineAktarOnay) closeModalSonrakineAktarOnay();
    });
  }

  var btnSonrakineAktarOnay = document.getElementById('btn-sonrakine-aktar-onay');
  if (btnSonrakineAktarOnay) {
    btnSonrakineAktarOnay.addEventListener('click', function () {
      var id = sonrakineAktarPendingId;
      if (!id || !supabase) return;
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
        var curr = res.data;
        if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
          closeModalSonrakineAktarOnay();
        return;
      }
        var cesit = (curr.cesit || '').trim();
        var ekim = curr.ekim_tarihi || '';
        var miktar = Number(curr.extra_fide);
        supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).gt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: true }).limit(1).then(function (r2) {
          var nextRows = (r2.data && r2.data.length) ? r2.data : [];
          var nextStok = nextRows[0];
          if (!nextStok) {
            closeModalSonrakineAktarOnay();
            return;
          }
          var nextExtra = (nextStok.extra_fide != null ? Number(nextStok.extra_fide) : 0);
          supabase.from('fide_stok').update({ extra_fide: 0 }).eq('id', id).then(function (a) {
            if (a.error) { closeModalSonrakineAktarOnay(); return; }
            supabase.from('fide_stok').update({ extra_fide: nextExtra + miktar }).eq('id', nextStok.id).then(function (b) {
              closeModalSonrakineAktarOnay();
              if (!b.error) loadStok();
            });
          });
        });
      });
    });
  }

  var oncekineAktarPendingId = null;
  var modalOncekineAktarOnay = document.getElementById('modal-onceki-aktar-onay');

  function closeModalOncekineAktarOnay() {
    oncekineAktarPendingId = null;
    if (modalOncekineAktarOnay) {
      modalOncekineAktarOnay.classList.remove('open');
      modalOncekineAktarOnay.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="onceki-aktar-onay"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalOncekineAktarOnay);
  });
  if (modalOncekineAktarOnay) {
    modalOncekineAktarOnay.addEventListener('click', function (e) {
      if (e.target === modalOncekineAktarOnay) closeModalOncekineAktarOnay();
    });
  }

  var btnOncekineAktarOnay = document.getElementById('btn-onceki-aktar-onay-confirm');
  if (btnOncekineAktarOnay) {
    btnOncekineAktarOnay.addEventListener('click', function () {
      var id = oncekineAktarPendingId;
      if (!id || !supabase) return;
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
        var curr = res.data;
        if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
          closeModalOncekineAktarOnay();
          return;
        }
        var cesit = (curr.cesit || '').trim();
        var ekim = curr.ekim_tarihi || '';
        var miktar = Number(curr.extra_fide);
        supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).lt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: false }).limit(1).then(function (r2) {
          var prevRows = (r2.data && r2.data.length) ? r2.data : [];
          var prevStok = prevRows[0];
          if (!prevStok) {
            closeModalOncekineAktarOnay();
            return;
          }
          var prevExtra = (prevStok.extra_fide != null ? Number(prevStok.extra_fide) : 0);
          supabase.from('fide_stok').update({ extra_fide: 0 }).eq('id', id).then(function (a) {
            if (a.error) { closeModalOncekineAktarOnay(); return; }
            supabase.from('fide_stok').update({ extra_fide: prevExtra + miktar }).eq('id', prevStok.id).then(function (b) {
              closeModalOncekineAktarOnay();
              if (!b.error) loadStok();
    });
  });
        });
      });
    });
  }

  var copFideId = null;
  var modalCop = document.getElementById('modal-cop');
  var copMiktarEl = document.getElementById('cop-miktar');

  function openModalCop(fideId) {
    copFideId = fideId;
    if (copMiktarEl) copMiktarEl.value = '';
    if (modalCop) {
      modalCop.classList.add('open');
      modalCop.setAttribute('aria-hidden', 'false');
      if (copMiktarEl) copMiktarEl.focus();
    }
  }

  function closeModalCop() {
    copFideId = null;
    if (modalCop) {
      modalCop.classList.remove('open');
      modalCop.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="cop"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCop);
  });
  if (modalCop) {
    modalCop.addEventListener('click', function (e) {
      if (e.target === modalCop) closeModalCop();
    });
  }

  var silOnayPendingId = null;
  var modalSilOnay = document.getElementById('modal-sil-onay');
  function openModalSilOnay(id) {
    silOnayPendingId = id;
    if (modalSilOnay) { modalSilOnay.classList.add('open'); modalSilOnay.setAttribute('aria-hidden', 'false'); }
  }
  function closeModalSilOnay() {
    silOnayPendingId = null;
    if (modalSilOnay) { modalSilOnay.classList.remove('open'); modalSilOnay.setAttribute('aria-hidden', 'true'); }
  }
  document.querySelectorAll('[data-modal-close="sil-onay"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSilOnay);
  });
  if (modalSilOnay) {
    modalSilOnay.addEventListener('click', function (e) {
      if (e.target === modalSilOnay) closeModalSilOnay();
    });
  }
  var btnSilOnay = document.getElementById('btn-sil-onay');
  if (btnSilOnay) {
    btnSilOnay.addEventListener('click', function () {
      var id = silOnayPendingId;
      closeModalSilOnay();
      if (!id || !supabase) return;
      supabase.from('fide_stok').delete().eq('id', id).then(function (res) {
        if (!res.error) {
          loadStok();
        } else {
          var msg = (res.error && res.error.message) ? res.error.message : 'Silme yapılamadı.';
          if (/foreign key|violates|referenced|ilişkili/i.test(msg)) {
            openModalUyari('Bu kayıt silinemiyor: Satış veya başka ilişkili kayıtlar var. Önce ilgili satışları kaldırmanız gerekebilir.');
          } else {
            openModalUyari('Silinemedi: ' + msg);
          }
        }
      });
    });
  }

  var modalUyari = document.getElementById('modal-uyari');
  var modalUyariMesaj = document.getElementById('modal-uyari-mesaj');
  function openModalUyari(msg) {
    if (modalUyariMesaj) modalUyariMesaj.textContent = msg || '';
    if (modalUyari) { modalUyari.classList.add('open'); modalUyari.setAttribute('aria-hidden', 'false'); }
  }
  function closeModalUyari() {
    if (modalUyari) { modalUyari.classList.remove('open'); modalUyari.setAttribute('aria-hidden', 'true'); }
  }
  document.querySelectorAll('[data-modal-close="uyari"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalUyari);
  });
  if (modalUyari) {
    modalUyari.addEventListener('click', function (e) {
      if (e.target === modalUyari) closeModalUyari();
    });
  }

  var btnCopOnay = document.getElementById('btn-cop-onay');
  if (btnCopOnay) {
    btnCopOnay.addEventListener('click', function () {
      if (!copFideId || !supabase) return;
      var miktar = parseMiktar(copMiktarEl && copMiktarEl.value);
      if (miktar === null || miktar < 1) {
        alert('Çöpe atılacak miktar 1 veya daha fazla olmalıdır.');
        return;
      }
      supabase.from('fide_stok').select('extra_fide').eq('id', copFideId).maybeSingle().then(function (r) {
        var extra = (r.data && r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
        if (miktar > extra) {
          alert('Stokta yeterli extra fide yok (mevcut: ' + extra + ').');
          return;
        }
        supabase.from('cop_kayitlari').insert({ fide_id: copFideId, miktar: miktar }).then(function (res) {
          if (res.error) return;
          supabase.from('fide_stok').update({ extra_fide: extra - miktar }).eq('id', copFideId).then(function (u) {
            closeModalCop();
            if (!u.error) loadStok();
    });
  });
      });
    });
  }

  var stokTbody = document.getElementById('stok-tbody');
  if (stokTbody) {
    stokTbody.addEventListener('click', function (e) {
      var id;
      var btnSat = e.target.closest('.btn-sat');
      if (btnSat) {
        id = btnSat.getAttribute('data-id');
        if (id) openModalSat(id);
        return;
      }
      var btnKimeSatildi = e.target.closest('.btn-kime-satildi');
      if (btnKimeSatildi) {
        id = btnKimeSatildi.getAttribute('data-id');
        if (id) openModalKimeSatildi(id);
        return;
      }
      var btnDegistir = e.target.closest('.btn-degistir');
      if (btnDegistir) {
        id = btnDegistir.getAttribute('data-id');
        if (id) openModalDegistir(id);
        return;
      }
      var btnAktar = e.target.closest('.btn-aktar');
      if (btnAktar) {
        id = btnAktar.getAttribute('data-id');
        if (id && supabase) {
          supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
            var curr = res.data;
            if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
              openModalUyari('Bu satırda aktarılacak extra fide yok.');
              return;
            }
            var cesit = (curr.cesit || '').trim();
            var ekim = curr.ekim_tarihi || '';
            supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).gt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: true }).limit(1).then(function (r2) {
              var nextRows = (r2.data && r2.data.length) ? r2.data : [];
              if (!nextRows[0]) {
                openModalUyari('Sonraki ekim tarihine ait stok kaydı bulunamadı.');
                return;
              }
              sonrakineAktarPendingId = id;
              var modalOnay = document.getElementById('modal-sonrakine-aktar-onay');
              if (modalOnay) {
                modalOnay.classList.add('open');
                modalOnay.setAttribute('aria-hidden', 'false');
              }
            });
          });
        }
        return;
      }
      var btnOncekiAktar = e.target.closest('.btn-onceki-aktar');
      if (btnOncekiAktar) {
        id = btnOncekiAktar.getAttribute('data-id');
        if (id && supabase) {
          supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
            var curr = res.data;
            if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
              openModalUyari('Bu satırda aktarılacak extra fide yok.');
              return;
            }
            var cesit = (curr.cesit || '').trim();
            var ekim = curr.ekim_tarihi || '';
            supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).lt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: false }).limit(1).then(function (r2) {
              var prevRows = (r2.data && r2.data.length) ? r2.data : [];
              if (!prevRows[0]) {
                openModalUyari('Önceki ekim tarihine ait stok kaydı bulunamadı.');
                return;
              }
              oncekineAktarPendingId = id;
              var modalOnay = document.getElementById('modal-onceki-aktar-onay');
              if (modalOnay) {
                modalOnay.classList.add('open');
                modalOnay.setAttribute('aria-hidden', 'false');
              }
            });
          });
        }
        return;
      }
      var btnCopeAt = e.target.closest('.btn-cope-at');
      if (btnCopeAt) {
        id = btnCopeAt.getAttribute('data-id');
        if (id) openModalCop(id);
        return;
      }
      var btn = e.target.closest('.btn-sil');
      if (btn) {
        id = btn.getAttribute('data-id');
        if (id && supabase) openModalSilOnay(id);
        return;
      }
    });
  }

  loadStok();
})();
