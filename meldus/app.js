(function () {
  'use strict';

  /** Aynı butona kısa sürede ikinci tıklamayı yoksay (çift tıklama / yanlışlıkla çift vuruş) */
  var BTN_DOUBLE_CLICK_MS = 500;
  var btnLastClickAt = new WeakMap();

  /** DB yazma / kritik onay: yanıt gelene kadar butonu kilitler (yavaş ağda çift gönderimi önler) */
  function submitLock(btn) {
    if (!btn) return function () {};
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    return function unlock() {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    };
  }

  function supabaseErrorMsg(err, fallback) {
    var msg = (err && err.message) ? String(err.message) : '';
    if (/ekim_no/i.test(msg)) return 'Ekim no için veritabanında ekim_no kolonu gerekir.';
    if (/kargo/i.test(msg)) return 'Kargo kutusu için veritabanında kargo kolonu gerekir.';
    if (/notlar/i.test(msg)) return 'Notlar alanı için veritabanında notlar kolonu gerekir.';
    return msg || fallback || 'İşlem başarısız.';
  }

  function currentMeldusUser() {
    if (window.meldusAuth && typeof window.meldusAuth.getUser === 'function') {
      return window.meldusAuth.getUser() || 'bilinmiyor';
    }
    return 'bilinmiyor';
  }

  function logIslem(islem, detay) {
    if (!supabase) return;
    var payload = {
      kullanici: currentMeldusUser(),
      islem: String(islem || '').slice(0, 80),
      detay: String(detay || '').slice(0, 800)
    };
    supabase.from('meldus_islem_log').insert(payload).then(function () {}).catch(function () {});
  }

  function joinLogDetay(parts) {
    return (parts || []).filter(function (p) {
      return p != null && String(p).trim() !== '';
    }).join(' · ');
  }

  function stokLogLabel(idOrRow) {
    var r = idOrRow;
    if (r == null || r === '') return '';
    if (typeof r !== 'object') {
      r = stok.find(function (x) { return String(x.id) === String(idOrRow); });
    }
    if (!r) return '';
    var parts = [];
    if (r.cesit) parts.push(String(r.cesit));
    if (r.ekim_tarihi) parts.push('ekim ' + formatDate(r.ekim_tarihi));
    var eno = parseEkimNo(r.ekim_no);
    if (eno) parts.push('ekim no ' + eno);
    return parts.join(' · ');
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('button');
    if (!btn || btn.disabled) return;
    var inMeldus =
      btn.closest('.panel-card') ||
      btn.closest('.modal-backdrop') ||
      btn.closest('.btn-teslim-wrap');
    if (!inMeldus) return;
    var now = Date.now();
    var prev = btnLastClickAt.get(btn);
    if (prev != null && now - prev < BTN_DOUBLE_CLICK_MS) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      return;
    }
    btnLastClickAt.set(btn, now);
  }, true);

  var supabase = null;
  if (typeof window.SUPABASE_URL !== 'undefined' && typeof window.SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
    supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  var modalYeni = document.getElementById('modal-yeni-kayit');
  var btnYeniKayit = document.getElementById('btn-yeni-kayit');
  var yeniCesit = document.getElementById('yeni-cesit');
  var yeniEkim = document.getElementById('yeni-ekim_tarihi');
  var yeniEkimNo = document.getElementById('yeni-ekim_no');
  var yeniMiktar = document.getElementById('yeni-ekilen_miktar');
  var btnKaydet = document.getElementById('btn-yeni-kayit-onay');
  var cesitDatalist = document.getElementById('yeni-cesit-list');
  var stok = [];
  var hiddenRowIds = {};
  var selectedStokIds = {};
  var quickFilterCesit = [];
  var quickFilterEkim = [];
  var quickFilterTeslim = [];
  var DATE_FILTER_EMPTY = '__empty__';
  var FILTER_ALL = '__all__';
  var tableSearchQuery = '';
  var cesitAutocompletePrevLen = 0;
  var stokSortKey = 'ekim_tarihi';
  var stokSortDir = 'asc';
  /** Satır sırası; sadece sütun başlığı tıklanınca yeniden kurulur. */
  var stokDisplayOrder = [];
  var EKIM_CUTOFF_DATE = '2026-06-01';
  var EKIM_CUTOFF_STORAGE_KEY = 'meldus-show-ekim-before-cutoff';
  var showEkimBeforeCutoff = false;

  try {
    showEkimBeforeCutoff = localStorage.getItem(EKIM_CUTOFF_STORAGE_KEY) === '1';
  } catch (e) {}

  function ekimTarihiIso(r) {
    return (r && r.ekim_tarihi) ? String(r.ekim_tarihi).trim().slice(0, 10) : '';
  }

  function teslimTarihiIso(r) {
    return (r && r.teslim_tarihi) ? String(r.teslim_tarihi).trim().slice(0, 10) : '';
  }

  function dateFilterMatches(iso, filterVals) {
    if (!filterVals || !filterVals.length) return true;
    if (!iso) return filterVals.indexOf(DATE_FILTER_EMPTY) !== -1;
    return filterVals.indexOf(iso) !== -1;
  }

  function isEkimBeforeCutoff(r) {
    var d = ekimTarihiIso(r);
    return Boolean(d && d < EKIM_CUTOFF_DATE);
  }

  function filterStokByEkimCutoff(list) {
    if (showEkimBeforeCutoff) return list;
    return list.filter(function (r) { return !isEkimBeforeCutoff(r); });
  }

  function filterRowsByRelatedEkimCutoff(rows, stokMap) {
    if (showEkimBeforeCutoff) return rows;
    return rows.filter(function (r) {
      var info = stokMap[r.fide_id];
      if (!info) return true;
      return !isEkimBeforeCutoff({ ekim_tarihi: info.ekim_tarihi });
    });
  }

  function relatedRowsHiddenByEkimCutoff(rows, stokMap) {
    if (showEkimBeforeCutoff) return false;
    return rows.some(function (r) {
      var info = stokMap[r.fide_id];
      return info && isEkimBeforeCutoff({ ekim_tarihi: info.ekim_tarihi });
    });
  }

  function sortStokList(list) {
    if (!stokSortKey) return list;
    list.sort(function (a, b) {
      var key = stokSortKey;
      var va = a[key];
      var vb = b[key];
      var cmp = 0;
      if (key === 'cesit') {
        va = (va || '').trim();
        vb = (vb || '').trim();
        cmp = stokSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (key === 'ekim_tarihi' || key === 'teslim_tarihi') {
        va = (va || '').toString().slice(0, 10);
        vb = (vb || '').toString().slice(0, 10);
        cmp = stokSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (key === 'ekim_no') {
        var sa = String(va == null ? '' : va).trim();
        var sb = String(vb == null ? '' : vb).trim();
        if (!sa && sb) cmp = 1;
        else if (sa && !sb) cmp = -1;
        else {
          var na = Number(sa);
          var nb = Number(sb);
          if (sa !== '' && sb !== '' && !isNaN(na) && !isNaN(nb)) {
            cmp = stokSortDir === 'asc' ? na - nb : nb - na;
          } else {
            cmp = stokSortDir === 'asc' ? sa.localeCompare(sb, 'tr') : sb.localeCompare(sa, 'tr');
          }
        }
      } else if (key === 'ekilen_miktar' || key === 'extra_fide') {
        va = Number(va);
        vb = Number(vb);
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
        cmp = stokSortDir === 'asc' ? va - vb : vb - va;
      }
      if (cmp !== 0) return cmp;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    return list;
  }

  function captureStokDisplayOrder(list) {
    stokDisplayOrder = (list || []).map(function (r) {
      return r && r.id != null ? String(r.id) : '';
    }).filter(Boolean);
  }

  function applyStokDisplayOrder(list) {
    if (!stokDisplayOrder.length) return list;
    var byId = {};
    list.forEach(function (r) {
      if (r && r.id != null) byId[String(r.id)] = r;
    });
    var ordered = [];
    var used = {};
    stokDisplayOrder.forEach(function (id) {
      var sid = String(id);
      if (byId[sid] && !used[sid]) {
        ordered.push(byId[sid]);
        used[sid] = true;
      }
    });
    list.forEach(function (r) {
      if (!r || r.id == null) return;
      var sid = String(r.id);
      if (!used[sid]) {
        ordered.push(r);
        used[sid] = true;
      }
    });
    return ordered;
  }

  function getStokListForDateOptions() {
    var list = stok.slice();
    if (quickFilterCesit.length) {
      list = list.filter(function (r) {
        return quickFilterCesit.some(function (name) { return cesitAdEsit(r.cesit, name); });
      });
    }
    return filterStokByEkimCutoff(list);
  }

  function getStokListFiltered() {
    var list = getStokListForDateOptions();
    if (quickFilterEkim.length) {
      list = list.filter(function (r) { return dateFilterMatches(ekimTarihiIso(r), quickFilterEkim); });
    }
    if (quickFilterTeslim.length) {
      list = list.filter(function (r) { return dateFilterMatches(teslimTarihiIso(r), quickFilterTeslim); });
    }
    if (tableSearchQuery) {
      var q = tableSearchQuery.toLowerCase();
      list = list.filter(function (r) {
        var cesitStr = (r.cesit || '').toLowerCase();
        var ekimStr = formatDate(r.ekim_tarihi).toLowerCase();
        var teslimStr = formatDate(r.teslim_tarihi).toLowerCase();
        var miktarStr = formatNum(r.ekilen_miktar).toLowerCase();
        var extraStr = formatNum(r.extra_fide).toLowerCase();
        var ekimNoStr = String(r.ekim_no == null ? '' : r.ekim_no).toLowerCase();
        return cesitStr.indexOf(q) !== -1 || ekimStr.indexOf(q) !== -1 || teslimStr.indexOf(q) !== -1 || miktarStr.indexOf(q) !== -1 || extraStr.indexOf(q) !== -1 || ekimNoStr.indexOf(q) !== -1;
      });
    }
    return list;
  }

  function getStokListForView() {
    var list = getStokListFiltered();
    if (stokDisplayOrder.length) return applyStokDisplayOrder(list);
    list = sortStokList(list.slice());
    captureStokDisplayOrder(list);
    return list;
  }

  function uniqueIsoDates(list, getIso) {
    var map = {};
    var hasEmpty = false;
    list.forEach(function (r) {
      var iso = getIso(r);
      if (!iso) hasEmpty = true;
      else map[iso] = true;
    });
    var keys = Object.keys(map).sort();
    return { keys: keys, hasEmpty: hasEmpty };
  }

  function dateFilterLabel(vals) {
    if (!vals || !vals.length) return 'Tümü';
    if (vals.length === 1) return vals[0] === DATE_FILTER_EMPTY ? '—' : formatDate(vals[0]);
    return vals.length + ' tarih';
  }

  function updateDateFilterButton(btn, vals) {
    if (!btn) return;
    btn.textContent = dateFilterLabel(vals);
    btn.classList.toggle('filter-active', vals.length > 0);
    var kind = 'Filtre';
    if (btn.id === 'stok-filter-ekim') kind = 'Ekim tarihi filtresi';
    else if (btn.id === 'stok-filter-teslim') kind = 'Teslim tarihi filtresi';
    else if (btn.id === 'stok-filter-cesit') kind = 'Çeşit filtresi';
    btn.setAttribute('aria-label', kind + ', ' + dateFilterLabel(vals));
  }

  function dateMultiAllHtml(isAll) {
    return '<label class="date-multi-option date-multi-all"><input type="checkbox" value="' + FILTER_ALL + '"' + (isAll ? ' checked' : '') + '> Tümü</label>';
  }

  function syncDateMultiChecks(panel, selected) {
    if (!panel) return;
    var isAll = !selected || !selected.length;
    panel.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (cb.value === FILTER_ALL) cb.checked = isAll;
      else cb.checked = selected.indexOf(cb.value) !== -1;
    });
  }

  function applyDateMultiChange(wrap, input) {
    if (!wrap || !input) return [];
    if (input.value === FILTER_ALL) {
      input.checked = true;
      wrap.querySelectorAll('.date-multi-option input').forEach(function (cb) {
        if (cb.value !== FILTER_ALL) cb.checked = false;
      });
      return [];
    }
    var vals = readDateFilterValues(wrap);
    var allCb = wrap.querySelector('.date-multi-all input');
    if (allCb) allCb.checked = vals.length === 0;
    return vals;
  }

  function fillStokDateFilter(host, isoInfo, currentArr) {
    if (!host) return [];
    var panel = host.querySelector('.date-multi-panel');
    var btn = host.querySelector('.date-multi-btn');
    if (!panel || !btn) return [];
    var valid = {};
    isoInfo.keys.forEach(function (k) { valid[k] = true; });
    if (isoInfo.hasEmpty) valid[DATE_FILTER_EMPTY] = true;
    var next = (currentArr || []).filter(function (v) { return valid[v]; });
    var keySig = isoInfo.keys.join('|') + (isoInfo.hasEmpty ? '|__empty__' : '');
    if (host.getAttribute('data-keys') !== keySig) {
      host.setAttribute('data-keys', keySig);
      var html = dateMultiAllHtml(next.length === 0);
      isoInfo.keys.forEach(function (iso) {
        html += '<label class="date-multi-option"><input type="checkbox" value="' + iso + '"' + (next.indexOf(iso) !== -1 ? ' checked' : '') + '> ' + formatDate(iso) + '</label>';
      });
      if (isoInfo.hasEmpty) {
        html += '<label class="date-multi-option"><input type="checkbox" value="' + DATE_FILTER_EMPTY + '"' + (next.indexOf(DATE_FILTER_EMPTY) !== -1 ? ' checked' : '') + '> —</label>';
      }
      if (!isoInfo.keys.length && !isoInfo.hasEmpty) html += '<p class="date-multi-empty">Tarih yok</p>';
      panel.innerHTML = html;
    } else {
      syncDateMultiChecks(panel, next);
    }
    updateDateFilterButton(btn, next);
    return next;
  }

  function updateStokFiltersClearBtn() {
    var clearBtn = document.getElementById('stok-date-filters-clear');
    if (clearBtn) clearBtn.hidden = !(quickFilterCesit.length || quickFilterEkim.length || quickFilterTeslim.length);
  }

  function fillStokDateFilterSelects() {
    var list = getStokListForDateOptions();
    quickFilterEkim = fillStokDateFilter(document.getElementById('stok-filter-ekim-wrap'), uniqueIsoDates(list, ekimTarihiIso), quickFilterEkim);
    quickFilterTeslim = fillStokDateFilter(document.getElementById('stok-filter-teslim-wrap'), uniqueIsoDates(list, teslimTarihiIso), quickFilterTeslim);
    updateStokFiltersClearBtn();
  }

  function closeAllDateMultis(exceptWrap) {
    document.querySelectorAll('.date-multi').forEach(function (wrap) {
      if (exceptWrap && wrap === exceptWrap) return;
      var panel = wrap.querySelector('.date-multi-panel');
      var btn = wrap.querySelector('.date-multi-btn');
      if (panel) panel.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleDateMulti(wrap) {
    if (!wrap) return;
    var panel = wrap.querySelector('.date-multi-panel');
    var btn = wrap.querySelector('.date-multi-btn');
    var open = panel && panel.hidden;
    closeAllDateMultis(open ? wrap : null);
    if (!panel || !btn) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function readDateFilterValues(wrap) {
    var vals = [];
    if (!wrap) return vals;
    wrap.querySelectorAll('.date-multi-option input:checked').forEach(function (cb) {
      if (cb.value && cb.value !== FILTER_ALL) vals.push(cb.value);
    });
    return vals;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var s = String(iso).trim().slice(0, 10);
    if (s.length !== 10) return '—';
    return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
  }

  function parseEkimNo(str) {
    var v = String(str == null ? '' : str).trim();
    return v ? v : null;
  }

  function formatEkimNo(v) {
    var s = parseEkimNo(v);
    return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '—';
  }

  function isKargo(row) {
    return !!(row && (row.kargo === true || row.kargo === 'true' || row.kargo === 't'));
  }

  function kargoBadgeHtml(row) {
    return isKargo(row) ? ' <span class="kargo-badge">Kargo</span>' : '';
  }

  /** Teslim edilenler listesi: en son teslim üstte (tam ISO zaman damgası). */
  function tsTeslimEdildiSort(s) {
    if (!s) return 0;
    var t1 = s.teslim_edildi_tarihi != null ? Date.parse(String(s.teslim_edildi_tarihi).trim()) : NaN;
    if (!isNaN(t1)) return t1;
    var t2 = s.satis_tarihi != null ? Date.parse(String(s.satis_tarihi).trim()) : NaN;
    if (!isNaN(t2)) return t2;
    return 0;
  }

  function formatNum(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var s = String(Math.floor(Number(n)));
    var parts = [];
    while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
    if (s) parts.unshift(s);
    return parts.join('.');
  }

  /** Tabloda ve inputta kullanılan 10.000 biçimini tam sayıya çevirir (Onayla ile uyumlu). */
  function parseFormattedAdet(str) {
    var s = String(str || '').trim();
    if (s === '') return NaN;
    var digits = s.replace(/\D/g, '');
    if (digits === '') return NaN;
    var n = parseInt(digits, 10);
    return isNaN(n) ? NaN : n;
  }

  /** tr-TR büyük harf + İngilizce yazım varyantları (KANARYOLE, PRESİDENTİAL, …) */
  function stokCesitKey(cesit) {
    var raw = (cesit || '').trim();
    if (!raw) return '';
    var tr = raw.toLocaleUpperCase('tr-TR');
    if (tr === 'KANARYOLE') return 'kanaryole';
    if (tr === 'PRESİDENTİAL') return 'presidential';
    if (tr === 'COSPİRİNA') return 'cospirina';
    if (tr === 'VERNELİA') return 'vernelia';
    var en = raw.toUpperCase().replace(/İ/g, 'I');
    if (en === 'PRESIDENTIAL') return 'presidential';
    if (en === 'COSPIRINA') return 'cospirina';
    if (en === 'VERNELIA') return 'vernelia';
    return '';
  }

  function stokRowCesitClass(cesit) {
    var k = stokCesitKey(cesit);
    return k ? ('stok-row-cesit-' + k) : '';
  }

  var CESIT_EXPORT_ROW_BG = {
    kanaryole: '#ffffff',
    presidential: '#fef9c3',
    cospirina: '#ffedd5',
    vernelia: '#dbeafe'
  };

  var CESIT_STORAGE_KEY = 'meldus-cesit-tanimlari';
  var DEFAULT_CESITLER = ['KANARYOLE', 'PRESİDENTİAL', 'COSPİRİNA', 'VERNELİA'];
  var cesitTanimlari = [];

  function normalizeCesitAd(ad) {
    return (ad || '').trim().toLocaleUpperCase('tr-TR');
  }

  function cesitAdEsit(a, b) {
    return normalizeCesitAd(a) === normalizeCesitAd(b);
  }

  function loadCesitTanimlari() {
    try {
      var raw = localStorage.getItem(CESIT_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          cesitTanimlari = parsed.map(function (x) {
            return { name: normalizeCesitAd(x.name), hidden: Boolean(x.hidden) };
          }).filter(function (x) { return x.name; });
          return;
        }
      }
    } catch (e) {}
    cesitTanimlari = DEFAULT_CESITLER.map(function (n) { return { name: n, hidden: false }; });
    saveCesitTanimlari();
  }

  function saveCesitTanimlari() {
    try {
      localStorage.setItem(CESIT_STORAGE_KEY, JSON.stringify(cesitTanimlari));
    } catch (e) {}
  }

  function sortCesitTanimlari() {
    cesitTanimlari.sort(function (a, b) { return a.name.localeCompare(b.name, 'tr'); });
  }

  function findCesitTanim(ad) {
    var key = normalizeCesitAd(ad);
    for (var i = 0; i < cesitTanimlari.length; i++) {
      if (cesitTanimlari[i].name === key) return cesitTanimlari[i];
    }
    return null;
  }

  function syncCesitTanimlariFromStok() {
    var seen = {};
    cesitTanimlari.forEach(function (c) { seen[c.name] = true; });
    var changed = false;
    stok.forEach(function (r) {
      var n = normalizeCesitAd(r.cesit);
      if (n && !seen[n]) {
        cesitTanimlari.push({ name: n, hidden: false });
        seen[n] = true;
        changed = true;
      }
    });
    if (changed) {
      sortCesitTanimlari();
      saveCesitTanimlari();
    }
  }

  function cesitKullanimda(ad) {
    var key = normalizeCesitAd(ad);
    return stok.some(function (r) {
      if (normalizeCesitAd(r.cesit) !== key) return false;
      if (!showEkimBeforeCutoff && isEkimBeforeCutoff(r)) return false;
      return true;
    });
  }

  function getVisibleCesitTanimlari() {
    return cesitTanimlari.filter(function (c) { return !c.hidden; });
  }

  function getCesitNamesForForms() {
    var names = {};
    cesitTanimlari.forEach(function (c) {
      if (!c.hidden) names[c.name] = true;
    });
    stok.forEach(function (r) {
      var n = normalizeCesitAd(r.cesit);
      if (n) names[n] = true;
    });
    return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  function updateCesitDatalists() {
    var list = getCesitNamesForForms();
    var html = list.map(function (c) { return '<option value="' + c.replace(/"/g, '&quot;') + '">'; }).join('');
    if (cesitDatalist) cesitDatalist.innerHTML = html;
    var degistirList = document.getElementById('degistir-cesit-list');
    if (degistirList) degistirList.innerHTML = html;
  }

  function cesitFilterLabel(vals) {
    if (!vals || !vals.length) return 'Tümü';
    if (vals.length === 1) return vals[0];
    return vals.length + ' çeşit';
  }

  function renderCesitFilters() {
    var host = document.getElementById('stok-filter-cesit-wrap');
    if (!host) return;
    var panel = host.querySelector('.date-multi-panel');
    var btn = host.querySelector('.date-multi-btn');
    if (!panel || !btn) return;
    var names = getVisibleCesitTanimlari().map(function (c) { return c.name; });
    var valid = {};
    names.forEach(function (n) { valid[n] = true; });
    quickFilterCesit = (quickFilterCesit || []).filter(function (n) { return valid[n]; });
    var keySig = names.join('|');
    if (host.getAttribute('data-keys') !== keySig) {
      host.setAttribute('data-keys', keySig);
      var html = dateMultiAllHtml(quickFilterCesit.length === 0);
      names.forEach(function (name) {
        html += '<label class="date-multi-option"><input type="checkbox" value="' + name.replace(/"/g, '&quot;') + '"' + (quickFilterCesit.indexOf(name) !== -1 ? ' checked' : '') + '> ' + name.replace(/</g, '&lt;') + '</label>';
      });
      if (!names.length) html += '<p class="date-multi-empty">Çeşit yok</p>';
      panel.innerHTML = html;
    } else {
      syncDateMultiChecks(panel, quickFilterCesit);
    }
    btn.textContent = cesitFilterLabel(quickFilterCesit);
    btn.classList.toggle('filter-active', quickFilterCesit.length > 0);
    btn.setAttribute('aria-label', 'Çeşit filtresi, ' + cesitFilterLabel(quickFilterCesit));
    updateStokFiltersClearBtn();
  }

  function renderCesitGizleList() {
    var host = document.getElementById('cesit-gizle-list');
    if (!host) return;

    var visible = cesitTanimlari.filter(function (c) { return !c.hidden; });
    var hidden = cesitTanimlari.filter(function (c) { return c.hidden; });
    var html = '';

    if (!visible.length && !hidden.length) {
      host.innerHTML = '<p class="empty-msg">Henüz çeşit tanımı yok.</p>';
      return;
    }

    if (visible.length) {
      html += '<p class="cesit-gizle-section-title">Görünür çeşitler</p>';
      visible.forEach(function (c) {
        var kullanimda = cesitKullanimda(c.name);
        html += '<div class="cesit-gizle-row">' +
          '<div><div class="cesit-gizle-row-name">' + c.name.replace(/</g, '&lt;') + '</div>' +
          '<div class="cesit-gizle-row-meta">' + (kullanimda ? 'Tabloda görünür stok kaydı var' : 'Görünür kayıt yok — gizlenebilir') + '</div></div>' +
          '<button type="button" class="btn-cesit-gizle-row" data-cesit-hide="' + c.name.replace(/"/g, '&quot;') + '"' + (kullanimda ? ' disabled title="Tabloda görünen stok kaydı olduğu için gizlenemez"' : '') + '>Gizle</button>' +
          '</div>';
      });
    }

    if (hidden.length) {
      html += '<p class="cesit-gizle-section-title">Gizli çeşitler</p>';
      hidden.forEach(function (c) {
        html += '<div class="cesit-gizle-row">' +
          '<div><div class="cesit-gizle-row-name">' + c.name.replace(/</g, '&lt;') + '</div>' +
          '<div class="cesit-gizle-row-meta">' + (cesitKullanimda(c.name) ? 'Tabloda görünür stok kaydı var' : 'Filtrede gizli') + '</div></div>' +
          '<button type="button" class="btn-cesit-goster-row" data-cesit-show="' + c.name.replace(/"/g, '&quot;') + '">Göster</button>' +
          '</div>';
      });
    }

    host.innerHTML = html;
  }

  function openModalCesitEkle() {
    var modal = document.getElementById('modal-cesit-ekle');
    var input = document.getElementById('cesit-ekle-ad');
    if (!modal) return;
    if (input) input.value = '';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (input) input.focus();
  }

  function closeModalCesitEkle() {
    var modal = document.getElementById('modal-cesit-ekle');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openModalCesitGizle() {
    var modal = document.getElementById('modal-cesit-gizle');
    if (!modal) return;
    renderCesitGizleList();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModalCesitGizle() {
    var modal = document.getElementById('modal-cesit-gizle');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function refreshCesitGizleModalIfOpen() {
    var m = document.getElementById('modal-cesit-gizle');
    if (m && m.classList.contains('open')) renderCesitGizleList();
  }

  function addCesitTanim(ad) {
    var name = normalizeCesitAd(ad);
    if (!name) {
      openModalUyari('Çeşit adı boş olamaz.');
      return false;
    }
    if (findCesitTanim(name)) {
      var existing = findCesitTanim(name);
      if (existing.hidden) {
        existing.hidden = false;
        saveCesitTanimlari();
        renderCesitFilters();
        updateCesitDatalists();
        return true;
      }
      openModalUyari('Bu çeşit zaten listede.');
      return false;
    }
    cesitTanimlari.push({ name: name, hidden: false });
    sortCesitTanimlari();
    saveCesitTanimlari();
    renderCesitFilters();
    updateCesitDatalists();
    return true;
  }

  function hideCesitTanim(ad) {
    var item = findCesitTanim(ad);
    if (!item || item.hidden) return;
    if (cesitKullanimda(item.name)) {
      openModalUyari('Bu çeşitte tabloda görünen stok kaydı var; gizlenemez. Eski kayıtlar 1 Haz. 2026 filtresiyle gizliyse çeşit gizlenebilir.');
      return;
    }
    item.hidden = true;
    quickFilterCesit = quickFilterCesit.filter(function (n) { return n !== item.name; });
    saveCesitTanimlari();
    renderCesitFilters();
    renderStok();
    renderCesitGizleList();
  }

  function showCesitTanim(ad) {
    var item = findCesitTanim(ad);
    if (!item || !item.hidden) return;
    item.hidden = false;
    saveCesitTanimlari();
    renderCesitFilters();
    renderCesitGizleList();
  }

  var stokLoadedOnce = false;
  var STOK_SKELETON_ROWS = 8;
  var SKELETON_DEFAULT_ROWS = 6;

  function skeletonBlock(className) {
    return '<span class="skeleton-block' + (className ? ' ' + className : '') + '"></span>';
  }

  function skeletonTableRow(cells) {
    var tds = cells.map(function (c) {
      var tdClass = c.className ? ' class="' + c.className + '"' : '';
      return '<td' + tdClass + '>' + skeletonBlock(c.block || 'skeleton-block-sm') + '</td>';
    }).join('');
    return '<tr class="skeleton-row" aria-hidden="true">' + tds + '</tr>';
  }

  function skeletonTableRows(cells, rowCount) {
    var html = '';
    for (var i = 0; i < rowCount; i++) html += skeletonTableRow(cells);
    return html;
  }

  var STOK_SKELETON_CELLS = [
    { className: 'col-cesit' },
    {},
    { className: 'col-ekim-no', block: 'skeleton-block-num' },
    {},
    { className: 'col-fide-qty', block: 'skeleton-block-num' },
    { className: 'col-fide-qty', block: 'skeleton-block-num' },
    { block: 'skeleton-block-actions' },
    { className: 'td-sec', block: 'skeleton-block-check' }
  ];

  var COP_SKELETON_CELLS = [{}, {}, {}, { block: 'skeleton-block-num' }, { block: 'skeleton-block-btn' }];
  var TESLIM_SKELETON_CELLS = [{}, {}, {}, { block: 'skeleton-block-num' }, {}, { block: 'skeleton-block-btn' }, {}, {}];
  var TESLIM_EDILENLER_SKELETON_CELLS = [{}, {}, {}, {}, {}, { block: 'skeleton-block-num' }, { block: 'skeleton-block-btn' }];
  var KIME_SATILDI_SKELETON_CELLS = [{}, {}, {}, {}, { block: 'skeleton-block-num' }, {}, { block: 'skeleton-block-btn' }];

  function stokSkeletonRowHtml() {
    return skeletonTableRow(STOK_SKELETON_CELLS);
  }

  function renderStokSkeleton() {
    var tbody = document.getElementById('stok-tbody');
    if (!tbody) return;
    tbody.innerHTML = skeletonTableRows(STOK_SKELETON_CELLS, STOK_SKELETON_ROWS);
    tbody.setAttribute('aria-busy', 'true');
  }

  function renderCopSkeleton(wrapTable) {
    var rows = skeletonTableRows(COP_SKELETON_CELLS, 5);
    if (wrapTable) {
      return '<table class="panel-table"><thead><tr><th>Tarih</th><th>Çeşit</th><th>Ekim tarihi</th><th>Atılan miktar</th><th>İşlemler</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    return rows;
  }

  function renderStokHareketlerSkeleton() {
    var summary = '<p class="px-4 py-2 skeleton-section">' + skeletonBlock('skeleton-block-md') + '</p>';
    var satisTable = '<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Müşteri</th><th>Miktar</th></tr></thead><tbody>' +
      skeletonTableRows([{}, {}, { block: 'skeleton-block-num' }], 3) + '</tbody></table>';
    var copTable = '<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Miktar</th></tr></thead><tbody>' +
      skeletonTableRows([{}, { block: 'skeleton-block-num' }], 2) + '</tbody></table>';
    var aktarTable = '<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Hedef (ekim · çeşit)</th><th>Miktar</th></tr></thead><tbody>' +
      skeletonTableRows([{}, {}, { block: 'skeleton-block-num' }], 2) + '</tbody></table>';
    return summary + satisTable + summary + copTable + summary + aktarTable;
  }

  function renderKimeSatildiSkeleton() {
    return '<table class="panel-table"><thead><tr><th>Tarih</th><th>Müşteri</th><th>Ekim Tarihi</th><th>Teslim Tarihi</th><th>Adet</th><th>Not</th><th>İşlemler</th></tr></thead><tbody>' +
      skeletonTableRows(KIME_SATILDI_SKELETON_CELLS, 5) + '</tbody></table>';
  }

  function loadStok() {
    if (!supabase) {
      var tbodyNoConn = document.getElementById('stok-tbody');
      if (tbodyNoConn) {
        tbodyNoConn.removeAttribute('aria-busy');
        tbodyNoConn.innerHTML = '<tr><td colspan="8" class="empty-state px-4 py-8">Veritabanı bağlantısı yok.</td></tr>';
      }
      return;
    }
    if (!stokLoadedOnce) renderStokSkeleton();
    supabase.from('fide_stok').select('*').is('deleted_at', null).order('ekim_tarihi', { ascending: false }).then(function (res) {
      if (res.error) {
        var tbodyErr = document.getElementById('stok-tbody');
        var errMsg = String(res.error.message || res.error);
        if (tbodyErr) {
          tbodyErr.removeAttribute('aria-busy');
          tbodyErr.innerHTML = '<tr><td colspan="8" class="empty-state px-4 py-8">Stok yüklenemedi: ' +
            errMsg.replace(/</g, '&lt;') + '</td></tr>';
        }
        if (/deleted_at/i.test(errMsg)) {
          openModalUyari('Stok listesi için deleted_at kolonu gerekir. Supabase’de meldus/sql/fide_stok_soft_delete.sql dosyasını çalıştırın.');
        } else {
          openModalUyari('Stok listesi yüklenemedi: ' + supabaseErrorMsg(res.error));
        }
        return;
      }
      stok = (res.data && res.data.slice()) || [];
      syncCesitTanimlariFromStok();
      renderCesitFilters();
      updateCesitDatalists();
      stokLoadedOnce = true;
      refreshStokHareketIds(function () { renderStok(); });
    });
  }

  function softDeleteStokByIds(ids, done) {
    if (!supabase || !ids || !ids.length) {
      if (done) done({ error: { message: 'Silinecek kayıt yok.' } });
      return;
    }
    var nowIso = new Date().toISOString();
    supabase.from('fide_stok').update({ deleted_at: nowIso }).in('id', ids).then(function (res) {
      if (done) done(res);
    });
  }

  function restoreStokById(id, done) {
    if (!supabase || !id) {
      if (done) done({ error: { message: 'Kayıt yok.' } });
      return;
    }
    supabase.from('fide_stok').update({ deleted_at: null }).eq('id', id).then(function (res) {
      if (done) done(res);
    });
  }

  function loadSilinenlerInto(hostEl) {
    if (!hostEl) return;
    if (!supabase) {
      hostEl.innerHTML = '<p class="px-4 py-2">Bağlantı yok.</p>';
      return;
    }
    hostEl.innerHTML = '<p class="px-4 py-2">Yükleniyor…</p>';
    hostEl.setAttribute('aria-busy', 'true');
    supabase.from('fide_stok').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200).then(function (res) {
      hostEl.removeAttribute('aria-busy');
      if (res.error) {
        var errMsg = String(res.error.message || res.error);
        if (/deleted_at/i.test(errMsg)) {
          hostEl.innerHTML = '<p class="px-4 py-2">Silinenler için deleted_at kolonu gerekir. Supabase’de meldus/sql/fide_stok_soft_delete.sql çalıştırın.</p>';
        } else {
          hostEl.innerHTML = '<p class="px-4 py-2">Liste yüklenemedi: ' + errMsg.replace(/</g, '&lt;') + '</p>';
        }
        return;
      }
      var rows = res.data || [];
      if (rows.length === 0) {
        hostEl.innerHTML = '<p class="px-4 py-2">Silinen kayıt yok.</p>';
        return;
      }
      var inner = rows.map(function (r) {
        var id = String(r.id || '').replace(/"/g, '');
        var cesit = String(r.cesit || '—').replace(/</g, '&lt;');
        var ekimStr = formatDate(r.ekim_tarihi);
        var silStr = formatDate(r.deleted_at);
        var viyol = formatNum(r.ekilen_miktar);
        var extra = formatNum(r.extra_fide);
        return '<tr><td class="px-4 py-2">' + silStr + '</td><td class="px-4 py-2">' + cesit +
          '</td><td class="px-4 py-2">' + ekimStr + '</td><td class="px-4 py-2">' + viyol +
          '</td><td class="px-4 py-2">' + extra +
          '</td><td class="px-4 py-2"><button type="button" class="btn-silinen-geri-al" data-id="' + id + '">Geri al</button></td></tr>';
      }).join('');
      hostEl.innerHTML = '<table class="panel-table"><thead><tr><th>Silinme</th><th>Çeşit</th><th>Ekim tarihi</th><th>Ekilen</th><th>Extra</th><th>İşlem</th></tr></thead><tbody>' + inner + '</tbody></table>';
    });
  }

  function openModalSilinenler() {
    var modal = document.getElementById('modal-silinenler');
    var body = document.getElementById('modal-silinenler-body');
    if (!modal || !body) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    loadSilinenlerInto(body);
  }

  function closeModalSilinenler() {
    var modal = document.getElementById('modal-silinenler');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function refreshSilinenlerModalIfOpen() {
    var m = document.getElementById('modal-silinenler');
    var b = document.getElementById('modal-silinenler-body');
    if (m && b && m.classList.contains('open')) loadSilinenlerInto(b);
  }

  var stokHareketIds = {};

  function markStokHareket(fideId) {
    if (fideId == null || fideId === '') return;
    stokHareketIds[String(fideId)] = true;
  }

  function hasStokHareket(fideId) {
    return !!stokHareketIds[String(fideId)];
  }

  function refreshStokHareketIds(done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (!supabase) {
      stokHareketIds = {};
      finish();
      return;
    }
    var ids = [];
    var seen = {};
    stok.forEach(function (r) {
      if (r.id == null) return;
      var sid = String(r.id);
      if (seen[sid]) return;
      seen[sid] = true;
      ids.push(r.id);
    });
    if (ids.length === 0) {
      stokHareketIds = {};
      finish();
      return;
    }
    Promise.all([
      supabase.from('satislar').select('fide_id').in('fide_id', ids),
      supabase.from('cop_kayitlari').select('fide_id').in('fide_id', ids),
      supabase.from('extra_aktar_hareketleri').select('kaynak_fide_id').in('kaynak_fide_id', ids)
    ]).then(function (results) {
      var map = {};
      function addId(v) {
        if (v == null || v === '') return;
        map[String(v)] = true;
      }
      ((results[0] && results[0].data) || []).forEach(function (row) { addId(row.fide_id); });
      ((results[1] && results[1].data) || []).forEach(function (row) { addId(row.fide_id); });
      ((results[2] && results[2].data) || []).forEach(function (row) { addId(row.kaynak_fide_id); });
      stokHareketIds = map;
      finish();
    }).catch(function () {
      finish();
    });
  }

  function loadCopInto(hostEl, wrapTable) {
    if (!hostEl) return;
    var copTfoot = document.getElementById('cop-tfoot');
    function clearCopTfoot() {
      if (copTfoot && !wrapTable) copTfoot.innerHTML = '';
    }
    function clearCopBusy() {
      if (!wrapTable) hostEl.removeAttribute('aria-busy');
    }
    if (!supabase) {
      if (wrapTable) hostEl.innerHTML = '<p class="px-4 py-2">Bağlantı yok.</p>';
      else hostEl.innerHTML = '<tr><td colspan="5" class="px-4 py-2">Bağlantı yok.</td></tr>';
      clearCopTfoot();
      return;
    }
    if (wrapTable) hostEl.innerHTML = renderCopSkeleton(true);
    else {
      hostEl.innerHTML = renderCopSkeleton(false);
      hostEl.setAttribute('aria-busy', 'true');
    }
    clearCopTfoot();
    supabase.from('cop_kayitlari').select('*').order('id', { ascending: false }).then(function (res) {
      if (res.error) {
        clearCopBusy();
        if (wrapTable) hostEl.innerHTML = '<p class="px-4 py-2">Liste yüklenemedi.</p>';
        else hostEl.innerHTML = '<tr><td colspan="5" class="px-4 py-2">Liste yüklenemedi.</td></tr>';
        clearCopTfoot();
        return;
      }
      var rows = res.data || [];
      if (rows.length === 0) {
        clearCopBusy();
        if (wrapTable) hostEl.innerHTML = '<p class="px-4 py-2">Henüz çöp kaydı yok.</p>';
        else hostEl.innerHTML = '<tr><td colspan="5" class="px-4 py-2">Henüz çöp kaydı yok.</td></tr>';
        clearCopTfoot();
        return;
      }
      var fideIds = [];
      var seen = {};
      rows.forEach(function (r) {
        var fid = r.fide_id;
        if (fid != null && !seen[fid]) { seen[fid] = true; fideIds.push(fid); }
      });
      function fillCopRows(stokMap) {
        clearCopBusy();
        var visibleRows = filterRowsByRelatedEkimCutoff(rows, stokMap);
        if (visibleRows.length === 0) {
          var copEmptyMsg = relatedRowsHiddenByEkimCutoff(rows, stokMap)
            ? '1 Haziran 2026 öncesi çöp kayıtları gizli. Göstermek için «1 Haz. 2026 öncesini göster» kutusunu işaretleyin.'
            : 'Henüz çöp kaydı yok.';
          if (wrapTable) hostEl.innerHTML = '<p class="px-4 py-2">' + copEmptyMsg + '</p>';
          else hostEl.innerHTML = '<tr><td colspan="5" class="px-4 py-2">' + copEmptyMsg + '</td></tr>';
          clearCopTfoot();
          return;
        }
        var toplam = visibleRows.reduce(function (s, r) {
          var n = r.miktar != null ? Number(r.miktar) : 0;
          return s + (isNaN(n) ? 0 : n);
        }, 0);
        var inner = visibleRows.map(function (r) {
          var info = stokMap[r.fide_id];
          var cesit = (info && info.cesit ? info.cesit : '—').replace(/</g, '&lt;');
          var ekimStr = info && info.ekim_tarihi ? formatDate(String(info.ekim_tarihi)) : '—';
          var t = r.created_at || r.tarih || r.inserted_at;
          var tarihStr = t ? formatDate(String(t)) : '—';
          var copId = String(r.id || '').replace(/"/g, '');
          var fid = String(r.fide_id || '').replace(/"/g, '');
          var mNum = r.miktar != null ? Number(r.miktar) : 0;
          if (isNaN(mNum)) mNum = 0;
          var act = '<button type="button" class="btn-degistir row-act btn-cop-kaydi-degistir" data-cop-id="' + copId + '" data-fide-id="' + fid + '" data-miktar="' + mNum + '">Değiştir</button> <button type="button" class="btn-sil btn-cop-kaydi-sil" data-cop-id="' + copId + '" data-fide-id="' + fid + '" data-miktar="' + mNum + '">Sil</button>';
          return '<tr><td class="px-4 py-2">' + tarihStr + '</td><td class="px-4 py-2">' + cesit + '</td><td class="px-4 py-2">' + ekimStr + '</td><td class="px-4 py-2">' + formatNum(r.miktar) + '</td><td class="px-4 py-2">' + act + '</td></tr>';
        }).join('');
        var footRow = '<tr><td colspan="3" class="px-4 py-2" style="text-align:right;font-weight:700;">Toplam</td><td class="px-4 py-2" style="font-weight:700;">' + formatNum(toplam) + '</td><td class="px-4 py-2"></td></tr>';
        if (wrapTable) {
          hostEl.innerHTML = '<table class="panel-table"><thead><tr><th>Tarih</th><th>Çeşit</th><th>Ekim tarihi</th><th>Atılan miktar</th><th>İşlemler</th></tr></thead><tbody>' + inner + '</tbody><tfoot>' + footRow + '</tfoot></table>';
        } else {
          hostEl.innerHTML = inner;
          if (copTfoot) copTfoot.innerHTML = footRow;
        }
      }
      if (fideIds.length === 0) {
        fillCopRows({});
        return;
      }
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').in('id', fideIds).then(function (r2) {
        var stokMap = {};
        (r2.data || []).forEach(function (f) {
          stokMap[f.id] = { cesit: f.cesit || '—', ekim_tarihi: f.ekim_tarihi };
        });
        fillCopRows(stokMap);
      });
    });
  }

  function loadCop() {
    var tbody = document.getElementById('cop-tbody');
    loadCopInto(tbody, false);
  }

  function openModalCopKaydi() {
    var modal = document.getElementById('modal-cop-kaydi');
    var body = document.getElementById('modal-cop-kaydi-body');
    if (!modal || !body) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    loadCopInto(body, true);
  }

  function closeModalCopKaydi() {
    var modal = document.getElementById('modal-cop-kaydi');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function refreshCopKaydiModalIfOpen() {
    var m = document.getElementById('modal-cop-kaydi');
    var b = document.getElementById('modal-cop-kaydi-body');
    if (m && b && m.classList.contains('open')) loadCopInto(b, true);
  }

  var modalStokHareketler = document.getElementById('modal-stok-hareketler');
  var modalStokHareketlerBody = document.getElementById('modal-stok-hareketler-body');
  var modalStokHareketlerTitle = document.getElementById('modal-stok-hareketler-title');
  var stokHareketlerFideId = null;

  function openModalStokHareketler(fideId) {
    if (!modalStokHareketler || !modalStokHareketlerBody) return;
    stokHareketlerFideId = fideId;
    var r = stok.find(function (x) { return String(x.id) === String(fideId); });
    var baslik = (r && r.cesit) ? (r.cesit + ' – ' + formatDate(r.ekim_tarihi)) : 'Hareketler';
    if (modalStokHareketlerTitle) modalStokHareketlerTitle.textContent = baslik;
    modalStokHareketlerBody.innerHTML = renderStokHareketlerSkeleton();
    modalStokHareketlerBody.setAttribute('aria-busy', 'true');
    modalStokHareketler.classList.add('open');
    modalStokHareketler.setAttribute('aria-hidden', 'false');
    if (!supabase) {
      modalStokHareketlerBody.removeAttribute('aria-busy');
      modalStokHareketlerBody.innerHTML = '<p class="px-4 py-2">Bağlantı yok.</p>';
      return;
    }
    Promise.all([
      supabase.from('satislar').select('id, miktar, musteri_adi, satis_tarihi').eq('fide_id', fideId).order('satis_tarihi', { ascending: false }),
      supabase.from('cop_kayitlari').select('id, miktar, created_at, tarih').eq('fide_id', fideId).order('id', { ascending: false }),
      supabase.from('extra_aktar_hareketleri').select('id, miktar, tip, hedef_fide_id, created_at').eq('kaynak_fide_id', fideId).order('created_at', { ascending: false })
    ]).then(function (results) {
      var satisRes = results[0];
      var copRes = results[1];
      var aktarRes = results[2];
      var satisList = (satisRes.data && satisRes.data.slice()) || [];
      var copList = (copRes.data && copRes.data.slice()) || [];
      var aktarList = (!aktarRes.error && aktarRes.data && aktarRes.data.slice()) || [];
      var toplamSatis = satisList.reduce(function (s, x) {
        var n = x.miktar != null ? Number(x.miktar) : 0;
        return s + (isNaN(n) ? 0 : n);
      }, 0);
      var toplamCop = copList.reduce(function (s, x) {
        var n = x.miktar != null ? Number(x.miktar) : 0;
        return s + (isNaN(n) ? 0 : n);
      }, 0);
      var sonrakineRows = aktarList.filter(function (x) { return x.tip === 'sonrakine'; });
      var oncekineRows = aktarList.filter(function (x) { return x.tip === 'oncekine'; });
      var toplamSonrakine = sonrakineRows.reduce(function (s, x) {
        var n = x.miktar != null ? Number(x.miktar) : 0;
        return s + (isNaN(n) ? 0 : n);
      }, 0);
      var toplamOncekine = oncekineRows.reduce(function (s, x) {
        var n = x.miktar != null ? Number(x.miktar) : 0;
        return s + (isNaN(n) ? 0 : n);
      }, 0);
      var hedefSeen = {};
      aktarList.forEach(function (x) {
        if (x.hedef_fide_id) hedefSeen[String(x.hedef_fide_id)] = true;
      });
      var hedefIds = Object.keys(hedefSeen);

      function hedefEtiket(map, hid) {
        var row = map[hid];
        if (!row) return '—';
        var c = (row.cesit || '—').replace(/</g, '&lt;');
        return formatDate(row.ekim_tarihi) + ' · ' + c;
      }

      function buildHtml(hedefMap) {
        var parts = [];
        parts.push('<p class="px-4 py-2" style="font-weight:700; margin-bottom:0.5rem;">Satılan: ' + formatNum(toplamSatis) + '</p>');
        if (satisList.length > 0) {
          parts.push('<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Müşteri</th><th>Miktar</th></tr></thead><tbody>');
          satisList.forEach(function (x) {
            var tarih = formatDate(x.satis_tarihi);
            var musteri = (x.musteri_adi || '—').replace(/</g, '&lt;');
            parts.push('<tr><td class="px-4 py-2">' + tarih + '</td><td class="px-4 py-2">' + musteri + '</td><td class="px-4 py-2">' + formatNum(x.miktar) + '</td></tr>');
          });
          parts.push('</tbody></table>');
        }
        parts.push('<p class="px-4 py-2" style="font-weight:700; margin-bottom:0.5rem;">Çöpe atılan: ' + formatNum(toplamCop) + '</p>');
        if (copList.length > 0) {
          parts.push('<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Miktar</th></tr></thead><tbody>');
          copList.forEach(function (x) {
            var t = x.created_at || x.tarih;
            var tarih = t ? formatDate(String(t)) : '—';
            parts.push('<tr><td class="px-4 py-2">' + tarih + '</td><td class="px-4 py-2">' + formatNum(x.miktar) + '</td></tr>');
          });
          parts.push('</tbody></table>');
        }
        parts.push('<p class="px-4 py-2" style="font-weight:700; margin-bottom:0.5rem;">Sonrakine aktarılan: ' + formatNum(toplamSonrakine) + '</p>');
        if (sonrakineRows.length > 0) {
          parts.push('<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Hedef (ekim · çeşit)</th><th>Miktar</th><th>İşlem</th></tr></thead><tbody>');
          sonrakineRows.forEach(function (x) {
            var t = x.created_at ? formatDate(String(x.created_at)) : '—';
            var hid = String(x.hedef_fide_id || '').replace(/"/g, '');
            var aid = String(x.id || '').replace(/"/g, '');
            var mNum = x.miktar != null ? Number(x.miktar) : 0;
            if (isNaN(mNum)) mNum = 0;
            parts.push(
              '<tr><td class="px-4 py-2">' + t + '</td><td class="px-4 py-2">' + hedefEtiket(hedefMap, String(x.hedef_fide_id)) +
              '</td><td class="px-4 py-2">' + formatNum(x.miktar) +
              '</td><td class="px-4 py-2"><button type="button" class="btn-aktar-geri-al" data-aktar-id="' + aid +
              '" data-hedef-id="' + hid + '" data-miktar="' + mNum + '" data-tip="sonrakine">Geri al</button></td></tr>'
            );
          });
          parts.push('</tbody></table>');
        }
        parts.push('<p class="px-4 py-2" style="font-weight:700; margin-bottom:0.5rem;">Öncekine aktarılan: ' + formatNum(toplamOncekine) + '</p>');
        if (oncekineRows.length > 0) {
          parts.push('<table class="panel-table" style="margin-bottom:1rem;"><thead><tr><th>Tarih</th><th>Hedef (ekim · çeşit)</th><th>Miktar</th><th>İşlem</th></tr></thead><tbody>');
          oncekineRows.forEach(function (x) {
            var t2 = x.created_at ? formatDate(String(x.created_at)) : '—';
            var hid2 = String(x.hedef_fide_id || '').replace(/"/g, '');
            var aid2 = String(x.id || '').replace(/"/g, '');
            var mNum2 = x.miktar != null ? Number(x.miktar) : 0;
            if (isNaN(mNum2)) mNum2 = 0;
            parts.push(
              '<tr><td class="px-4 py-2">' + t2 + '</td><td class="px-4 py-2">' + hedefEtiket(hedefMap, String(x.hedef_fide_id)) +
              '</td><td class="px-4 py-2">' + formatNum(x.miktar) +
              '</td><td class="px-4 py-2"><button type="button" class="btn-aktar-geri-al" data-aktar-id="' + aid2 +
              '" data-hedef-id="' + hid2 + '" data-miktar="' + mNum2 + '" data-tip="oncekine">Geri al</button></td></tr>'
            );
          });
          parts.push('</tbody></table>');
        }
        if (aktarRes.error) {
          parts.push('<p class="px-4 py-2" style="color:#b45309; font-size:0.9rem;">Aktarım kayıtları okunamadı. Supabase’de <code>extra_aktar_hareketleri</code> tablosunu oluşturduğunuzdan emin olun (SUPABASE_SETUP.md 1.4).</p>');
        }
        modalStokHareketlerBody.removeAttribute('aria-busy');
        modalStokHareketlerBody.innerHTML = parts.join('');
      }

      if (hedefIds.length === 0) {
        buildHtml({});
        return;
      }
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').in('id', hedefIds).then(function (rH) {
        var hedefMap = {};
        (rH.data || []).forEach(function (row) { hedefMap[String(row.id)] = row; });
        buildHtml(hedefMap);
      }).catch(function () { buildHtml({}); });
    }).catch(function () {
      modalStokHareketlerBody.removeAttribute('aria-busy');
      modalStokHareketlerBody.innerHTML = '<p class="px-4 py-2">Yüklenemedi.</p>';
    });
  }

  function closeModalStokHareketler() {
    stokHareketlerFideId = null;
    if (modalStokHareketler) {
      modalStokHareketler.classList.remove('open');
      modalStokHareketler.setAttribute('aria-hidden', 'true');
    }
  }

  function geriAlAktarHareket(aktarId, hedefId, miktar, tip) {
    var kaynakId = stokHareketlerFideId;
    if (!supabase || !aktarId || !hedefId || !kaynakId) return;
    var m = Number(miktar);
    if (isNaN(m) || m < 1) {
      openModalUyari('Geçersiz aktarım miktarı.');
      return;
    }
    var tipLabel = tip === 'oncekine' ? 'Öncekine aktarım' : 'Sonrakine aktarım';
    openModalOnay(tipLabel + ' geri alınacak (' + formatNum(m) + ' extra fide). Emin misiniz?', function () {
      Promise.all([
        supabase.from('fide_stok').select('id, extra_fide, cesit, ekim_tarihi, ekim_no').eq('id', kaynakId).maybeSingle(),
        supabase.from('fide_stok').select('id, extra_fide, cesit, ekim_tarihi').eq('id', hedefId).maybeSingle()
      ]).then(function (rows) {
        var kaynak = rows[0] && rows[0].data;
        var hedef = rows[1] && rows[1].data;
        if (!kaynak || !hedef) {
          openModalUyari('Stok kayıtları bulunamadı.');
          return;
        }
        var kaynakExtra = kaynak.extra_fide != null ? Number(kaynak.extra_fide) : 0;
        var hedefExtra = hedef.extra_fide != null ? Number(hedef.extra_fide) : 0;
        if (isNaN(kaynakExtra)) kaynakExtra = 0;
        if (isNaN(hedefExtra)) hedefExtra = 0;
        if (hedefExtra < m) {
          openModalUyari('Hedef stokta yeterli extra fide yok (mevcut: ' + formatNum(hedefExtra) + ', gerekli: ' + formatNum(m) + ').');
          return;
        }
        return supabase.from('fide_stok').update({ extra_fide: hedefExtra - m }).eq('id', hedefId).then(function (a) {
          if (a.error) {
            openModalUyari('Geri alınamadı: ' + supabaseErrorMsg(a.error));
            return;
          }
          return supabase.from('fide_stok').update({ extra_fide: kaynakExtra + m }).eq('id', kaynakId).then(function (b) {
            if (b.error) {
              return supabase.from('fide_stok').update({ extra_fide: hedefExtra }).eq('id', hedefId).then(function () {
                openModalUyari('Geri alınamadı. Hedef stok eski haline getirildi.');
                loadStok();
              });
            }
            return supabase.from('extra_aktar_hareketleri').delete().eq('id', aktarId).then(function (d) {
              if (d.error) {
                openModalUyari('Stoklar düzeltildi ama aktarım kaydı silinemedi. Supabase’de delete politikasını ekleyin (meldus/sql/extra_aktar_delete_policy.sql).');
              } else {
                logIslem('Aktarım geri al', joinLogDetay([
                  tipLabel,
                  formatNum(m) + ' extra fide',
                  stokLogLabel(kaynak),
                  formatDate(hedef.ekim_tarihi) + ' tarihli ekimden ' + formatDate(kaynak.ekim_tarihi) + ' tarihli ekime geri'
                ]));
              }
              loadStok();
              if (stokHareketlerFideId) openModalStokHareketler(stokHareketlerFideId);
            });
          });
        });
      });
    }, { confirmText: 'Geri al' });
  }

  if (modalStokHareketlerBody) {
    modalStokHareketlerBody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-aktar-geri-al');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      geriAlAktarHareket(
        btn.getAttribute('data-aktar-id'),
        btn.getAttribute('data-hedef-id'),
        btn.getAttribute('data-miktar'),
        btn.getAttribute('data-tip')
      );
    });
  }

  document.querySelectorAll('[data-modal-close="stok-hareketler"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalStokHareketler);
  });

  function renderStok() {
    var tbody = document.getElementById('stok-tbody');
    if (!tbody) return;
    if (!stokLoadedOnce) return;
    renderCesitFilters();
    fillStokDateFilterSelects();
    tbody.removeAttribute('aria-busy');
    try { hiddenRowIds = JSON.parse(localStorage.getItem('meldus_hidden_row_ids') || '{}'); } catch (e) {}
    var list = getStokListForView();
    var topEl = document.getElementById('stok-extra-fide-toplam');
    var topEkilenEl = document.getElementById('stok-ekilen-toplam');
    if (list.length === 0) {
      if (topEl) topEl.textContent = formatNum(0);
      if (topEkilenEl) topEkilenEl.textContent = formatNum(0);
      var emptyMsg = tableSearchQuery
        ? 'Arama ile eşleşen kayıt yok.'
        : ((quickFilterEkim.length || quickFilterTeslim.length)
          ? 'Bu tarih filtresine uyan kayıt yok.'
          : (quickFilterCesit.length
            ? 'Bu çeşit filtresine uyan kayıt yok.'
            : (!showEkimBeforeCutoff && stok.some(isEkimBeforeCutoff)
              ? '1 Haziran 2026 öncesi kayıtlar gizli. Göstermek için «1 Haz. 2026 öncesini göster» kutusunu işaretleyin.'
              : 'Henüz kayıt yok. Yeni kayıt ekleyin.')));
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state px-4 py-8">' + emptyMsg + '</td></tr>';
      return;
    }
    var toplamExtra = list.reduce(function (sum, r) {
      var n = r.extra_fide != null ? Number(r.extra_fide) : 0;
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    var toplamEkilen = list.reduce(function (sum, r) {
      var n = r.ekilen_miktar != null ? Number(r.ekilen_miktar) : 0;
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    if (topEl) topEl.textContent = formatNum(toplamExtra);
    if (topEkilenEl) topEkilenEl.textContent = formatNum(toplamEkilen);
    tbody.innerHTML = list.map(function (r) {
      var id = r.id || '';
      var extraFide = r.extra_fide != null ? Number(r.extra_fide) : 0;
      var hidden = hiddenRowIds[id] || (isNaN(extraFide) ? false : extraFide === 0);
      var sel = selectedStokIds[id];
      var cesitCls = stokRowCesitClass(r.cesit);
      var trClasses = [];
      if (hidden) trClasses.push('row-hidden');
      if (cesitCls) trClasses.push(cesitCls);
      var trClassAttr = trClasses.length ? ' class="' + trClasses.join(' ') + '"' : '';
      return '<tr data-id="' + id + '"' + trClassAttr + '>' +
        '<td class="px-4 py-2 col-cesit">' + (r.cesit || '—').replace(/</g, '&lt;') + '</td>' +
        '<td class="px-4 py-2">' + formatDate(r.ekim_tarihi) + '</td>' +
        '<td class="px-4 py-2 col-ekim-no">' + formatEkimNo(r.ekim_no) + '</td>' +
        '<td class="px-4 py-2">' + formatDate(r.teslim_tarihi) + '</td>' +
        '<td class="px-4 py-2 col-fide-qty">' + formatNum(r.ekilen_miktar) + '</td>' +
        '<td class="px-4 py-2 col-fide-qty">' + formatNum(r.extra_fide) + '</td>' +
        '<td class="px-4 py-2"><button type="button" class="btn-sat row-act" data-id="' + id + '">Sat</button> <button type="button" class="btn-kime-satildi row-act" data-id="' + id + '">Kime satıldı</button> <button type="button" class="btn-aktar row-act" data-id="' + id + '">Sonrakine aktar</button> <button type="button" class="btn-onceki-aktar row-act" data-id="' + id + '">Öncekine aktar</button> <button type="button" class="btn-cope-at row-act" data-id="' + id + '">Çöpe at</button> <button type="button" class="btn-degistir row-act" data-id="' + id + '">Değiştir</button> <button type="button" class="btn-gizle row-act" data-id="' + id + '">' + (hidden ? 'Göster' : 'Gizle') + '</button> <button type="button" class="btn-sil" data-id="' + id + '">Sil</button> <button type="button" class="btn-hareketler row-act" data-id="' + id + '"' + (hasStokHareket(id) ? '' : ' disabled title="Henüz hareket yok"') + '>Hareketler</button></td>' +
        '<td class="td-sec"><input type="checkbox" class="row-select" data-id="' + id + '"' + (sel ? ' checked' : '') + ' aria-label="Seç" /></td></tr>';
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
    if (info) info.style.display = n ? 'table-row' : 'none';
    if (countEl) countEl.textContent = n;
    if (btnToplu) btnToplu.disabled = n === 0;
  }

  function topluSil() {
    var btnToplu = document.getElementById('btn-toplu-sil');
    var ids = Object.keys(selectedStokIds).filter(function (id) { return selectedStokIds[id]; });
    if (ids.length === 0) return;
    if (!supabase) return;
    openModalOnay(ids.length + ' kayıt silinecek (geri alınabilir). Emin misiniz?', function () {
      var unlock = submitLock(btnToplu);
      softDeleteStokByIds(ids, function (res) {
        try {
          if (!res.error) {
            ids.forEach(function (id) { delete selectedStokIds[id]; });
            var ozet = ids.slice(0, 8).map(function (id) {
              return stokLogLabel(id) || ('id ' + id);
            }).join('; ');
            if (ids.length > 8) ozet += ' …';
            logIslem('Toplu silme', joinLogDetay([ids.length + ' kayıt silindi', ozet]));
            refreshSilinenlerModalIfOpen();
            loadStok();
          } else {
            var msg = (res.error && res.error.message) ? res.error.message : 'Silme yapılamadı.';
            if (/deleted_at/i.test(msg)) {
              openModalUyari('Silme için deleted_at kolonu gerekir. Supabase’de meldus/sql/fide_stok_soft_delete.sql çalıştırın.');
            } else {
              openModalUyari('Silinemedi: ' + msg);
            }
          }
        } finally {
          unlock();
        }
      });
    }, { confirmText: 'Sil' });
  }

  function openModalYeniKayit() {
    if (modalYeni) {
      if (yeniEkim) yeniEkim.value = new Date().toISOString().slice(0, 10);
      if (yeniEkimNo) yeniEkimNo.value = '';
      if (yeniCesit) { yeniCesit.value = ''; cesitAutocompletePrevLen = 0; }
      if (yeniMiktar) yeniMiktar.value = '';
      updateCesitDatalists();
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
  onEnterGoNext(yeniMiktar, yeniEkimNo);
  onEnterGoNext(yeniEkimNo, btnKaydet);

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
      var ekimNo = parseEkimNo(yeniEkimNo && yeniEkimNo.value);
      var miktar = parseMiktar(yeniMiktar && yeniMiktar.value);
      if (!cesit) {
        openModalUyari('Çeşit giriniz.');
        if (yeniCesit) yeniCesit.focus();
        return;
      }
      if (!ekim) {
        openModalUyari('Ekim tarihi giriniz.');
        if (yeniEkim) yeniEkim.focus();
        return;
      }
      if (miktar === null || miktar < 1) {
        openModalUyari('Ekilen viyol sayısı giriniz.');
        if (yeniMiktar) yeniMiktar.focus();
        return;
      }
      var teslim = addDays(ekim, 25);
      var extraFide = Math.round(miktar * 0.95) * 300;
      if (!supabase) return;
      var unlock = submitLock(btnKaydet);
      var payload = {
        cesit: cesit,
        ekim_tarihi: ekim,
        teslim_tarihi: teslim,
        ekilen_miktar: miktar,
        cikan_fide: 0,
        extra_fide: extraFide
      };
      if (ekimNo) payload.ekim_no = ekimNo;
      supabase.from('fide_stok').insert(payload).then(function (res) {
        if (res.error) {
          openModalUyari('Kayıt eklenemedi: ' + supabaseErrorMsg(res.error));
          return;
        }
        logIslem('Yeni kayıt', joinLogDetay([
          cesit,
          'ekim ' + formatDate(ekim),
          ekimNo ? 'ekim no ' + ekimNo : '',
          formatNum(miktar) + ' viyol',
          'extra ' + formatNum(extraFide),
          'teslim ' + formatDate(teslim)
        ]));
        closeModalYeniKayit();
        loadStok();
      }).finally(unlock);
    });
  }

  function downloadStokJpg() {
    var list = getStokListForView().filter(function (r) {
      var n = r.extra_fide != null ? Number(r.extra_fide) : 0;
      return !isNaN(n) && n > 3000;
    });
    if (list.length === 0) {
      openModalUyari('İndirilecek kayıt yok.');
      return;
    }
    var logoImg = new Image();
    logoImg.onload = function () { renderStokJpgDownload(list, logoImg); };
    logoImg.onerror = function () { renderStokJpgDownload(list, null); };
    logoImg.src = '/meldus/logo.png';
  }

  function renderStokJpgDownload(list, logoImg) {
    var pad = 20;
    var rowH = 36;
    var wCesit = 260;
    var wTeslim = 140;
    var wExtra = 120;
    var wViyol = 110;
    var W = pad * 2 + wCesit + wTeslim + wExtra + wViyol;
    var titleH = 52;
    var footerH = 48;
    var H = pad + titleH + rowH + list.length * rowH + footerH + pad;
    var exportScale = 4;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(W * exportScale);
    canvas.height = Math.round(H * exportScale);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    var navyBold = '#1e3a8a';
    var line = '#000000';
    var theadBg = '#166534';
    var theadText = '#ffffff';
    var rowA = '#ffffff';
    var rowB = '#f8fafc';
    var cellText = '#1e293b';
    var accentBar = '#15803d';

    function setSharpStroke(w) {
      ctx.strokeStyle = line;
      ctx.lineWidth = w != null ? w : 1.5;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
    }

    function strokeSharpRect(x, y, w, h, lw) {
      setSharpStroke(lw);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    }

    function strokeSharpVLine(x, y1, y2, lw) {
      setSharpStroke(lw);
      x = Math.round(x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(y1));
      ctx.lineTo(x, Math.round(y2));
      ctx.stroke();
    }

    function strokeSharpHLine(x1, x2, y, lw) {
      setSharpStroke(lw);
      y = Math.round(y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x1), y);
      ctx.lineTo(Math.round(x2), y);
      ctx.stroke();
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    var title = 'İKLİM FİDE EKSTRA LİSTESİ';
    ctx.font = 'bold 18px Arial, Helvetica, sans-serif';
    var titleW = ctx.measureText(title).width;
    var titleY = pad + 32;
    var logoSize = 36;
    var logoGap = 10;
    var headerBlockW = logoImg ? logoSize + logoGap + titleW : titleW;
    var headerLeft = W / 2 - headerBlockW / 2;
    ctx.fillStyle = accentBar;
    ctx.fillRect(Math.floor(W / 2) - 36, pad + 4, 72, 3);
    ctx.fillStyle = navyBold;
    if (logoImg) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(logoImg, headerLeft, pad + 8, logoSize, logoSize);
      ctx.imageSmoothingEnabled = false;
      ctx.textAlign = 'left';
      ctx.fillText(title, headerLeft + logoSize + logoGap, titleY);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(title, W / 2, titleY);
    }
    strokeSharpHLine(pad, W - pad, pad + titleH - 6, 1.5);
    var y = pad + titleH;
    var tableW = W - pad * 2;
    ctx.fillStyle = theadBg;
    ctx.fillRect(pad, y, tableW, rowH);
    strokeSharpRect(pad, y, tableW, rowH, 2);
    ctx.fillStyle = theadText;
    ctx.font = 'bold 14px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Çeşit', pad + 12, y + 24);
    ctx.textAlign = 'center';
    ctx.fillText('Teslim Tarihi', pad + wCesit + wTeslim / 2, y + 24);
    ctx.fillText('Extra Fide', pad + wCesit + wTeslim + wExtra / 2, y + 24);
    ctx.fillText('Viyol Tipi', pad + wCesit + wTeslim + wExtra + wViyol / 2, y + 24);
    ctx.textAlign = 'left';
    strokeSharpVLine(pad + wCesit, y, y + rowH);
    strokeSharpVLine(pad + wCesit + wTeslim, y, y + rowH);
    strokeSharpVLine(pad + wCesit + wTeslim + wExtra, y, y + rowH);
    y += rowH;
    ctx.font = '15px Arial, Helvetica, sans-serif';
    list.forEach(function (r, i) {
      var ck = stokCesitKey(r.cesit);
      var rowBg = ck && CESIT_EXPORT_ROW_BG[ck] ? CESIT_EXPORT_ROW_BG[ck] : (i % 2 === 0 ? rowA : rowB);
      ctx.fillStyle = rowBg;
      ctx.fillRect(pad, y, tableW, rowH);
      strokeSharpRect(pad, y, tableW, rowH, 1.5);
      strokeSharpVLine(pad + wCesit, y, y + rowH);
      strokeSharpVLine(pad + wCesit + wTeslim, y, y + rowH);
      strokeSharpVLine(pad + wCesit + wTeslim + wExtra, y, y + rowH);
      ctx.fillStyle = cellText;
      var cesit = String(r.cesit || '—');
      if (cesit.length > 28) cesit = cesit.slice(0, 27) + '…';
      ctx.textAlign = 'left';
      ctx.fillText(cesit, pad + 12, y + 24);
      ctx.textAlign = 'center';
      ctx.fillText(formatDate(r.teslim_tarihi), pad + wCesit + wTeslim / 2, y + 24);
      ctx.fillText(formatNum(r.extra_fide), pad + wCesit + wTeslim + wExtra / 2, y + 24);
      ctx.fillText("300'LÜK", pad + wCesit + wTeslim + wExtra + wViyol / 2, y + 24);
      ctx.textAlign = 'left';
      y += rowH;
    });
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px Arial, Helvetica, sans-serif';
    ctx.fillStyle = navyBold;
    ctx.fillText('İletişim: 0533 735 99 68', W / 2, y + 30);
    ctx.textAlign = 'left';
    var tarihStr = new Date().toISOString().slice(0, 10);
    var fname = 'İKLİM FİDE EXTRA LİSTESİ ' + tarihStr + '.JPG';
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/jpeg', 1);
    } else {
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/jpeg', 1);
      a.download = fname;
      a.click();
    }
  }

  var btnTopluSil = document.getElementById('btn-toplu-sil');
  if (btnTopluSil) {
    btnTopluSil.addEventListener('click', topluSil);
    btnTopluSil.disabled = true;
  }

  var btnStokJpg = document.getElementById('btn-stok-jpg-indir');
  if (btnStokJpg) btnStokJpg.addEventListener('click', downloadStokJpg);

  var showHiddenEl = document.getElementById('show-hidden-rows');
  var showEkimBeforeCutoffEl = document.getElementById('show-ekim-before-cutoff');
  var viewStok = document.getElementById('view-stok');
  if (showHiddenEl && viewStok) {
    showHiddenEl.addEventListener('change', function () {
      viewStok.classList.toggle('show-hidden-rows', showHiddenEl.checked);
    });
  }
  if (showEkimBeforeCutoffEl) {
    showEkimBeforeCutoffEl.checked = showEkimBeforeCutoff;
    showEkimBeforeCutoffEl.addEventListener('change', function () {
      showEkimBeforeCutoff = showEkimBeforeCutoffEl.checked;
      try {
        localStorage.setItem(EKIM_CUTOFF_STORAGE_KEY, showEkimBeforeCutoff ? '1' : '0');
      } catch (e) {}
      renderStok();
      refreshCopKaydiModalIfOpen();
      refreshCesitGizleModalIfOpen();
      refreshTeslimEdilenlerModalIfOpen();
      refreshTeslimModalIfOpen();
      loadCop();
    });
  }

  var btnCesitEkle = document.getElementById('btn-cesit-ekle');
  if (btnCesitEkle) btnCesitEkle.addEventListener('click', openModalCesitEkle);

  var btnCesitGizle = document.getElementById('btn-cesit-gizle');
  if (btnCesitGizle) btnCesitGizle.addEventListener('click', openModalCesitGizle);

  document.querySelectorAll('[data-modal-close="cesit-ekle"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCesitEkle);
  });
  document.querySelectorAll('[data-modal-close="cesit-gizle"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCesitGizle);
  });

  var btnCesitEkleOnay = document.getElementById('btn-cesit-ekle-onay');
  if (btnCesitEkleOnay) {
    btnCesitEkleOnay.addEventListener('click', function () {
      var input = document.getElementById('cesit-ekle-ad');
      if (addCesitTanim(input && input.value)) closeModalCesitEkle();
    });
  }

  var cesitGizleList = document.getElementById('cesit-gizle-list');
  if (cesitGizleList) {
    cesitGizleList.addEventListener('click', function (ev) {
      var hideBtn = ev.target.closest('[data-cesit-hide]');
      if (hideBtn) {
        hideCesitTanim(hideBtn.getAttribute('data-cesit-hide'));
        return;
      }
      var showBtn = ev.target.closest('[data-cesit-show]');
      if (showBtn) showCesitTanim(showBtn.getAttribute('data-cesit-show'));
    });
  }

  var cesitEkleAd = document.getElementById('cesit-ekle-ad');
  if (cesitEkleAd) {
    cesitEkleAd.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (addCesitTanim(cesitEkleAd.value)) closeModalCesitEkle();
      }
    });
  }

  var searchTableEl = document.getElementById('search-table');
  if (searchTableEl) {
    searchTableEl.addEventListener('input', function () {
      tableSearchQuery = (searchTableEl.value || '').trim();
      renderStok();
    });
  }

  var panelDateFilters = document.getElementById('panel-date-filters');
  var stokDateFiltersClear = document.getElementById('stok-date-filters-clear');
  if (panelDateFilters) {
    panelDateFilters.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.date-multi-btn');
      if (!btn) return;
      ev.preventDefault();
      toggleDateMulti(btn.closest('.date-multi'));
    });
    panelDateFilters.addEventListener('change', function (ev) {
      var input = ev.target;
      if (!input || !input.matches || !input.matches('.date-multi-option input')) return;
      var wrap = input.closest('.date-multi');
      if (!wrap) return;
      var field = wrap.getAttribute('data-filter-field') || wrap.getAttribute('data-date-field');
      var vals = applyDateMultiChange(wrap, input);
      if (field === 'cesit') quickFilterCesit = vals;
      else if (field === 'ekim') quickFilterEkim = vals;
      else if (field === 'teslim') quickFilterTeslim = vals;
      renderStok();
    });
  }
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('.date-multi')) return;
    closeAllDateMultis();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeAllDateMultis();
  });
  if (stokDateFiltersClear) {
    stokDateFiltersClear.addEventListener('click', function () {
      quickFilterCesit = [];
      quickFilterEkim = [];
      quickFilterTeslim = [];
      closeAllDateMultis();
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
        captureStokDisplayOrder(sortStokList(getStokListFiltered().slice()));
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
  var degistirEkimNo = document.getElementById('degistir-ekim_no');
  var degistirTeslim = document.getElementById('degistir-teslim_tarihi');
  var degistirEkilen = document.getElementById('degistir-ekilen_miktar');
  var degistirExtra = document.getElementById('degistir-extra_fide');
  var degistirCesitList = document.getElementById('degistir-cesit-list');
  var editingStokId = null;
  var editingDegistirOrigEkim = '';
  var editingDegistirOrigEkilen = null;

  function openModalDegistir(id) {
    var r = stok.find(function (x) { return String(x.id) === String(id); });
    if (!r) return;
    editingStokId = id;
    editingDegistirOrigEkim = toIsoDate(r.ekim_tarihi);
    editingDegistirOrigEkilen = r.ekilen_miktar != null && r.ekilen_miktar !== '' && !isNaN(Number(r.ekilen_miktar)) ? Number(r.ekilen_miktar) : 0;
    if (degistirCesit) degistirCesit.value = r.cesit || '';
    if (degistirEkim) degistirEkim.value = toIsoDate(r.ekim_tarihi);
    if (degistirEkimNo) degistirEkimNo.value = parseEkimNo(r.ekim_no) || '';
    if (degistirTeslim) degistirTeslim.value = toIsoDate(r.teslim_tarihi);
    if (degistirEkilen) degistirEkilen.value = r.ekilen_miktar != null && r.ekilen_miktar !== '' ? String(r.ekilen_miktar) : '';
    if (degistirExtra) degistirExtra.value = r.extra_fide != null && r.extra_fide !== '' ? String(r.extra_fide) : '';
    updateCesitDatalists();
    if (modalDegistir) {
      modalDegistir.classList.add('open');
      modalDegistir.setAttribute('aria-hidden', 'false');
      if (degistirCesit) degistirCesit.focus();
    }
  }

  function closeModalDegistir() {
    editingStokId = null;
    editingDegistirOrigEkim = '';
    editingDegistirOrigEkilen = null;
    if (modalDegistir) {
      modalDegistir.classList.remove('open');
      modalDegistir.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="degistir"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalDegistir);
  });
  var modalSat = document.getElementById('modal-sat');
  var satMusteri = document.getElementById('sat-musteri');
  var satTeslimTarihi = document.getElementById('sat-teslim-tarihi');
  var satMiktar = document.getElementById('sat-miktar');
  var satNotlar = document.getElementById('sat-notlar');
  var satKargo = document.getElementById('sat-kargo');
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
    if (satKargo) satKargo.checked = false;
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
      var musteri = (satMusteri && satMusteri.value || '').trim();
      var teslimTarihi = (satTeslimTarihi && satTeslimTarihi.value || '').trim();
      var miktar = parseMiktar(satMiktar && satMiktar.value);
      if (!musteri) {
        openModalUyari('Müşteri ismi giriniz.');
        if (satMusteri) satMusteri.focus();
        return;
      }
      if (!teslimTarihi) {
        openModalUyari('Teslim tarihi giriniz.');
        if (satTeslimTarihi) satTeslimTarihi.focus();
        return;
      }
      if (miktar === null || miktar < 1) {
        openModalUyari('Kaç adet 1 veya daha fazla olmalıdır.');
        if (satMiktar) satMiktar.focus();
        return;
      }
      var notlar = (satNotlar && satNotlar.value || '').trim() || null;
      var kargo = !!(satKargo && satKargo.checked);
      var unlock = submitLock(btnSatOnay);
      var satOk = false;
      // notlar kolonu yoksa: ALTER TABLE satislar ADD COLUMN notlar text;
      // kargo kolonu yoksa: ALTER TABLE satislar ADD COLUMN kargo boolean default false;
      supabase.from('satislar').insert({
        fide_id: satStokId,
        musteri_adi: musteri,
        teslim_tarihi: teslimTarihi,
        miktar: miktar,
        satis_tarihi: new Date().toISOString(),
        notlar: notlar,
        kargo: kargo
      }).then(function (res) {
        if (res.error) {
          openModalUyari('Satış kaydedilemedi: ' + supabaseErrorMsg(res.error));
          return null;
        }
        satOk = true;
        return supabase.from('fide_stok').select('extra_fide').eq('id', satStokId).maybeSingle();
      }).then(function (r) {
        if (!satOk) return null;
        if (!r || !r.data) {
          openModalUyari('Satış kaydedildi ama stok okunamadı. Stoku kontrol edin.');
          closeModalSat();
          loadStok();
          return null;
        }
        var extra = (r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
        return supabase.from('fide_stok').update({ extra_fide: extra - miktar }).eq('id', satStokId);
      }).then(function (upd) {
        if (!upd) return;
        if (upd.error) {
          openModalUyari('Satış kaydedildi ama stok düşülemedi: ' + supabaseErrorMsg(upd.error));
        }
        logIslem('Satış', joinLogDetay([
          musteri,
          formatNum(miktar) + ' adet',
          'teslim ' + formatDate(teslimTarihi),
          stokLogLabel(satStokId),
          kargo ? 'kargo' : '',
          notlar ? 'not: ' + notlar : ''
        ]));
        markStokHareket(satStokId);
        closeModalSat();
        loadStok();
      }).finally(unlock);
    });
  }

  var btnDegistirOnay = document.getElementById('btn-degistir-onay');
  if (btnDegistirOnay) {
    btnDegistirOnay.addEventListener('click', function () {
      if (!editingStokId || !supabase) return;
      var cesit = (degistirCesit && degistirCesit.value || '').trim();
      var ekim = (degistirEkim && degistirEkim.value || '').trim() || null;
      var ekimNo = parseEkimNo(degistirEkimNo && degistirEkimNo.value);
      var teslim = (degistirTeslim && degistirTeslim.value || '').trim() || null;
      var ekilen = parseMiktar(degistirEkilen && degistirEkilen.value);
      var extra = parseMiktar(degistirExtra && degistirExtra.value);
      if (!cesit) {
        openModalUyari('Çeşit giriniz.');
        if (degistirCesit) degistirCesit.focus();
        return;
      }
      if (!ekim) {
        openModalUyari('Ekim tarihi giriniz.');
        if (degistirEkim) degistirEkim.focus();
        return;
      }
      if (ekilen === null || ekilen < 1) {
        openModalUyari('Ekilen viyol sayısı giriniz.');
        if (degistirEkilen) degistirEkilen.focus();
        return;
      }
      if (extra === null) extra = 0;
      if (extra < 0) {
        openModalUyari('Extra fide negatif olamaz.');
        if (degistirExtra) degistirExtra.focus();
        return;
      }
      var ekimNorm = ekim ? String(ekim).slice(0, 10) : '';
      var ekimChanged = ekimNorm !== (editingDegistirOrigEkim || '');
      var ekilenChanged = ekilen !== (editingDegistirOrigEkilen != null ? editingDegistirOrigEkilen : 0);
      if (ekimChanged || ekilenChanged) {
        teslim = addDays(ekim, 25);
        extra = Math.round(ekilen * 0.95) * 300;
      }
      var unlock = submitLock(btnDegistirOnay);
      var payload = {
        cesit: cesit,
        ekim_tarihi: ekim,
        teslim_tarihi: teslim,
        ekilen_miktar: ekilen,
        extra_fide: extra
      };
      var origRow = stok.find(function (x) { return String(x.id) === String(editingStokId); });
      var origEkimNo = origRow ? parseEkimNo(origRow.ekim_no) : null;
      if (ekimNo || origEkimNo) payload.ekim_no = ekimNo;
      supabase.from('fide_stok').update(payload).eq('id', editingStokId).then(function (res) {
        if (res.error) {
          openModalUyari('Kayıt güncellenemedi: ' + supabaseErrorMsg(res.error));
          return;
        }
        logIslem('Kayıt değiştir', joinLogDetay([
          cesit,
          'ekim ' + formatDate(ekim),
          ekimNo ? 'ekim no ' + ekimNo : '',
          formatNum(ekilen) + ' viyol',
          'extra ' + formatNum(extra),
          'teslim ' + formatDate(teslim)
        ]));
        closeModalDegistir();
        loadStok();
      }).finally(unlock);
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
    var cesit = uniq(teslimDisplayRows.map(function (r) { return r.cesitStr; }));
    var musteri = uniq(teslimDisplayRows.map(function (r) { return r.musteri; }));
    var ekim = uniq(teslimDisplayRows.map(function (r) { return r.ekimStr; }));
    var teslim = uniq(teslimDisplayRows.map(function (r) { return r.teslim; }));
    var adet = uniq(teslimDisplayRows.map(function (r) { return r.miktarNum; }));
    function setOptions(id, values) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var prev = sel.value;
      sel.innerHTML = '<option value="">Tümü</option>';
      values.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      });
      if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) sel.value = prev;
    }
    setOptions('teslim-filter-cesit', cesit);
    setOptions('teslim-filter-musteri', musteri);
    setOptions('teslim-filter-ekim', ekim);
    setOptions('teslim-filter-teslim', teslim);
    setOptions('teslim-filter-adet', adet);
  }

  function fillTeslimEdilenlerFilterSelects() {
    var uniq = function (arr) { var s = {}; arr.forEach(function (v) { s[v] = true; }); return Object.keys(s).sort(); };
    var tarih = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.tarih; }));
    var cesit = uniq(teslimEdilenlerDisplayRows.map(function (r) { return r.cesitStr; }));
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
    setOptions('teslim-edilenler-filter-cesit', cesit);
    setOptions('teslim-edilenler-filter-musteri', musteri);
    setOptions('teslim-edilenler-filter-ekim', ekim);
    setOptions('teslim-edilenler-filter-teslim', teslim);
    setOptions('teslim-edilenler-filter-adet', adet);
  }

  function getTeslimFilteredRows() {
    var fKargo = (document.getElementById('teslim-filter-kargo') || {}).value || '';
    var fCesit = (document.getElementById('teslim-filter-cesit') || {}).value || '';
    var fMusteri = (document.getElementById('teslim-filter-musteri') || {}).value || '';
    var fEkim = (document.getElementById('teslim-filter-ekim') || {}).value || '';
    var fTeslim = (document.getElementById('teslim-filter-teslim') || {}).value || '';
    var fAdet = (document.getElementById('teslim-filter-adet') || {}).value || '';
    return teslimDisplayRows.filter(function (r) {
      var kargoOk = fKargo === '' || (fKargo === '1' && r.kargo) || (fKargo === '0' && !r.kargo);
      return kargoOk && (fCesit === '' || r.cesitStr === fCesit) && (fMusteri === '' || r.musteri === fMusteri) && (fEkim === '' || r.ekimStr === fEkim) && (fTeslim === '' || r.teslim === fTeslim) && (fAdet === '' || r.miktarNum === fAdet);
    });
  }

  function downloadTeslimExcel() {
    var rows = getTeslimFilteredRows();
    if (!rows.length) {
      openModalUyari('Aktarılacak kayıt yok.');
      return;
    }
    var unescapeHtml = function (s) {
      return String(s == null ? '' : s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
    };
    var xmlEsc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    var displayText = function (v) {
      return unescapeHtml(v == null ? '' : v);
    };
    var borders = '<Borders>' +
      '<Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>' +
      '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>' +
      '<Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>' +
      '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>' +
      '</Borders>';
    var cell = function (style, type, v) {
      var data;
      if (type === 'Number' || type === 'DateTime') data = String(v);
      else data = xmlEsc(displayText(v));
      return '<Cell ss:StyleID="' + style + '"><Data ss:Type="' + type + '">' + data + '</Data></Cell>';
    };
    var emptyCell = function (style) {
      return '<Cell ss:StyleID="' + style + '"/>';
    };
    var toExcelDate = function (str) {
      var s = displayText(str);
      if (!s || s === '—') return null;
      var dmy = s.match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
      if (dmy) return dmy[3] + '-' + dmy[2] + '-' + dmy[1] + 'T00:00:00.000';
      var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3] + 'T00:00:00.000';
      return null;
    };
    var dateCell = function (style, str) {
      var dt = toExcelDate(str);
      if (!dt) return emptyCell(style);
      return cell(style, 'DateTime', dt);
    };
    var headers = ['Çeşit', 'Müşteri', 'Teslim Tarihi', 'Adet', 'Not', 'Ekim Tarihi', 'Kargo'];
    var dataRows = rows.map(function (r) {
      var adet = Number(r.miktarRaw);
      if (isNaN(adet)) adet = 0;
      return [
        displayText(r.cesitStr),
        displayText(r.musteri),
        displayText(r.teslim),
        adet,
        displayText(r.notStr === '—' ? '' : r.notStr),
        displayText(r.ekimStr),
        r.kargo ? 'Evet' : 'Hayır'
      ];
    });
    var toplam = dataRows.reduce(function (sum, r) { return sum + r[3]; }, 0);
    var widthVal = function (v, i) {
      if (i === 3) return formatNum(v).length;
      if (i === 2 || i === 5) return 10;
      return String(v == null ? '' : v).length;
    };
    var colWidths = headers.map(function (h) { return String(h).length; });
    dataRows.forEach(function (r) {
      r.forEach(function (v, i) {
        var len = widthVal(v, i);
        if (len > colWidths[i]) colWidths[i] = len;
      });
    });
    var totLen = formatNum(toplam).length;
    if (totLen > colWidths[3]) colWidths[3] = totLen;
    if (6 > colWidths[0]) colWidths[0] = 6;
    var colXml = colWidths.map(function (len) {
      var w = Math.max(12, len + 3) * 6.2;
      if (w > 220) w = 220;
      return '<Column ss:AutoFitWidth="1" ss:Width="' + w.toFixed(1) + '"/>';
    }).join('');
    var xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<?mso-application progid="Excel.Sheet"?>' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles>' +
      '<Style ss:ID="sCell"><Alignment ss:Vertical="Center" ss:Horizontal="Center"/>' + borders + '</Style>' +
      '<Style ss:ID="sHead"><Font ss:Bold="1"/><Interior ss:Color="#E0F2FE" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Center"/>' + borders + '</Style>' +
      '<Style ss:ID="sTotal"><Font ss:Bold="1"/><Alignment ss:Vertical="Center" ss:Horizontal="Center"/>' + borders + '</Style>' +
      '<Style ss:ID="sNum"><Alignment ss:Vertical="Center" ss:Horizontal="Center"/><NumberFormat ss:Format="#,##0"/>' + borders + '</Style>' +
      '<Style ss:ID="sNumTotal"><Font ss:Bold="1"/><Alignment ss:Vertical="Center" ss:Horizontal="Center"/><NumberFormat ss:Format="#,##0"/>' + borders + '</Style>' +
      '<Style ss:ID="sDate"><Alignment ss:Vertical="Center" ss:Horizontal="Center"/><NumberFormat ss:Format="dd/mm/yyyy"/>' + borders + '</Style>' +
      '</Styles>' +
      '<Worksheet ss:Name="Teslim edilecekler"><Table>';
    xml += colXml;
    xml += '<Row>' + headers.map(function (h) { return cell('sHead', 'String', h); }).join('') + '</Row>';
    dataRows.forEach(function (r) {
      xml += '<Row>' +
        cell('sCell', 'String', r[0]) +
        cell('sCell', 'String', r[1]) +
        dateCell('sDate', r[2]) +
        cell('sNum', 'Number', r[3]) +
        cell('sCell', 'String', r[4]) +
        dateCell('sDate', r[5]) +
        cell('sCell', 'String', r[6]) +
        '</Row>';
    });
    xml += '<Row>' +
      cell('sTotal', 'String', 'Toplam') +
      emptyCell('sTotal') +
      emptyCell('sTotal') +
      cell('sNumTotal', 'Number', toplam) +
      emptyCell('sTotal') +
      emptyCell('sTotal') +
      emptyCell('sTotal') +
      '</Row>';
    xml += '</Table></Worksheet></Workbook>';
    var blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    var a = document.createElement('a');
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    a.href = URL.createObjectURL(blob);
    a.download = 'teslim-edilecekler-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function renderTeslimTable() {
    var filtered = getTeslimFilteredRows();
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var rows = filtered.map(function (r) {
      var sid = (r.satisId || '');
      var kargoCell = r.kargo ? '<span class="kargo-badge">Evet</span>' : '—';
      return '<tr data-satis-id="' + sid + '"><td class="px-4 py-2">' + esc(r.cesitStr || '—') + '</td><td class="px-4 py-2">' + esc(r.musteri) + '</td><td class="px-4 py-2">' + esc(r.teslim) + '</td><td class="px-4 py-2">' + esc(r.miktarNum) + '</td><td class="px-4 py-2">' + esc(r.notStr || '—') + '</td><td class="px-4 py-2"><button type="button" class="btn-teslim-et" data-satis-id="' + sid + '">Teslim et</button><button type="button" class="btn-teslim-kismi" data-satis-id="' + sid + '">Kısmen teslim et</button><button type="button" class="btn-satis-degistir" data-satis-id="' + sid + '">Değiştir</button></td><td class="px-4 py-2">' + esc(r.ekimStr) + '</td><td class="px-4 py-2">' + kargoCell + '</td></tr>';
    });
    if (modalTeslimTbody) modalTeslimTbody.innerHTML = rows.join('');
    var toplam = filtered.reduce(function (sum, r) { return sum + (r.miktarRaw || 0); }, 0);
    var toplamEl = document.getElementById('modal-teslim-toplam');
    if (toplamEl) toplamEl.textContent = formatNum(toplam);
  }

  function renderTeslimEdilenlerTable() {
    var fTarih = (document.getElementById('teslim-edilenler-filter-tarih') || {}).value || '';
    var fCesit = (document.getElementById('teslim-edilenler-filter-cesit') || {}).value || '';
    var fMusteri = (document.getElementById('teslim-edilenler-filter-musteri') || {}).value || '';
    var fEkim = (document.getElementById('teslim-edilenler-filter-ekim') || {}).value || '';
    var fTeslim = (document.getElementById('teslim-edilenler-filter-teslim') || {}).value || '';
    var fAdet = (document.getElementById('teslim-edilenler-filter-adet') || {}).value || '';
    var filtered = teslimEdilenlerDisplayRows.filter(function (r) {
      return (fTarih === '' || r.tarih === fTarih) && (fCesit === '' || r.cesitStr === fCesit) && (fMusteri === '' || r.musteri === fMusteri) && (fEkim === '' || r.ekimStr === fEkim) && (fTeslim === '' || r.teslim === fTeslim) && (fAdet === '' || r.miktarNum === fAdet);
    });
    filtered.sort(function (a, b) { return (b.tarihTs || 0) - (a.tarihTs || 0); });
    var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var rows = filtered.map(function (r) {
      var sid = (r.satisId || '');
      return '<tr data-satis-id="' + sid + '"><td class="px-4 py-2">' + esc(r.tarih) + '</td><td class="px-4 py-2">' + esc(r.cesitStr || '—') + '</td><td class="px-4 py-2">' + esc(r.musteri) + kargoBadgeHtml(r) + '</td><td class="px-4 py-2">' + esc(r.ekimStr) + '</td><td class="px-4 py-2">' + esc(r.teslim) + '</td><td class="px-4 py-2">' + esc(r.miktarNum) + '</td><td class="px-4 py-2"><button type="button" class="btn-teslim-geri-al" data-satis-id="' + sid + '">Geri al</button></td></tr>';
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
    if (modalKimeSatildi) {
      modalKimeSatildi.classList.add('open');
      modalKimeSatildi.setAttribute('aria-hidden', 'false');
    }
    if (!supabase || !modalKimeSatildiBody) {
      if (modalKimeSatildiBody) modalKimeSatildiBody.innerHTML = '<p style="padding:1rem;">Bağlantı yok.</p>';
      return;
    }
    modalKimeSatildiBody.innerHTML = renderKimeSatildiSkeleton();
    modalKimeSatildiBody.setAttribute('aria-busy', 'true');
    supabase.from('satislar').select('*').eq('fide_id', fideId).order('satis_tarihi', { ascending: false }).then(function (res) {
      modalKimeSatildiBody.removeAttribute('aria-busy');
      if (res.error) {
        modalKimeSatildiBody.innerHTML = '<p style="padding:1rem;">Liste yüklenemedi: ' +
          String(res.error.message || res.error).replace(/</g, '&lt;') + '</p>';
        return;
      }
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
        var sid = s.id || '';
        var total = s.miktar != null ? Number(s.miktar) : 0;
        if (isNaN(total)) total = 0;
        var del = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : 0;
        if (isNaN(del)) del = 0;
        var remaining = total - del;
        if (remaining < 0) remaining = 0;
        var teslimBtn = remaining > 0
          ? '<button type="button" class="btn-teslim-et" data-satis-id="' + sid + '" data-kalan="' + formatNum(remaining) + '">Teslim et</button> '
          : '';
        return '<tr data-satis-id="' + sid + '"><td class="px-4 py-2">' + tarih + '</td><td class="px-4 py-2">' + musteri + kargoBadgeHtml(s) + '</td><td class="px-4 py-2">' + ekimStr + '</td><td class="px-4 py-2">' + teslim + '</td><td class="px-4 py-2">' + formatNum(displayMiktar) + '</td><td class="px-4 py-2">' + notStr + '</td><td class="px-4 py-2">' + teslimBtn + '<button type="button" class="btn-satis-iptal" data-satis-id="' + sid + '">Satış iptal</button> <button type="button" class="btn-satis-degistir" data-satis-id="' + sid + '">Değiştir</button> <button type="button" class="btn-satis-aktar" data-satis-id="' + sid + '">Satışı aktar</button></td></tr>';
      });
      var toplamRow = '<tfoot><tr><td colspan="4" class="px-4 py-2">Toplam</td><td class="px-4 py-2">' + formatNum(toplam) + '</td><td></td><td></td></tr></tfoot>';
      var html = '<table class="panel-table"><thead><tr><th>Tarih</th><th>Müşteri</th><th>Ekim Tarihi</th><th>Teslim Tarihi</th><th>Adet</th><th>Not</th><th>İşlemler</th></tr></thead><tbody>' + rows.join('') + '</tbody>' + toplamRow + '</table>';
      modalKimeSatildiBody.innerHTML = list.length ? html : '<p style="padding:1rem;">Henüz satış kaydı yok.</p>';
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
    if (modalTeslimTbody) {
      modalTeslimTbody.innerHTML = skeletonTableRows(TESLIM_SKELETON_CELLS, SKELETON_DEFAULT_ROWS);
      modalTeslimTbody.setAttribute('aria-busy', 'true');
    }
    var toplamEl = document.getElementById('modal-teslim-toplam');
    if (toplamEl) toplamEl.textContent = '0';
    if (modalTeslim) {
      modalTeslim.classList.add('open');
      modalTeslim.setAttribute('aria-hidden', 'false');
    }
    if (!supabase || !modalTeslimTbody) {
      if (modalTeslimTbody) {
        modalTeslimTbody.removeAttribute('aria-busy');
        modalTeslimTbody.innerHTML = '<tr><td colspan="8" class="px-4 py-2">Bağlantı yok.</td></tr>';
      }
      return;
    }
    supabase.from('satislar').select('*').order('teslim_tarihi', { ascending: true }).then(function (res) {
      if (res.error) {
        teslimDisplayRows = [];
        if (modalTeslimTbody) {
          modalTeslimTbody.removeAttribute('aria-busy');
          modalTeslimTbody.innerHTML = '<tr><td colspan="8" class="px-4 py-2">Liste yüklenemedi: ' +
            String(res.error.message || res.error).replace(/</g, '&lt;') + '</td></tr>';
        }
        return;
      }
      var list = (res.data && res.data.slice()) || [];
      list = list.filter(function (s) {
        var m = s.miktar != null ? Number(s.miktar) : 0;
        if (isNaN(m)) m = 0;
        var del = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : 0;
        if (isNaN(del)) del = 0;
        return m - del > 0;
      });
      if (list.length === 0) {
        teslimDisplayRows = [];
        if (modalTeslimTbody) modalTeslimTbody.removeAttribute('aria-busy');
        modalTeslimTbody.innerHTML = '<tr><td colspan="8" class="px-4 py-2">Henüz teslim edilecek kayıt yok.</td></tr>';
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
        if (modalTeslimTbody) modalTeslimTbody.removeAttribute('aria-busy');
        var visibleList = filterRowsByRelatedEkimCutoff(list, stokMap);
        if (visibleList.length === 0) {
          teslimDisplayRows = [];
          var emptyMsg = relatedRowsHiddenByEkimCutoff(list, stokMap)
            ? '1 Haziran 2026 öncesi teslim kayıtları gizli. Göstermek için «1 Haz. 2026 öncesini göster» kutusunu işaretleyin.'
            : 'Henüz teslim edilecek kayıt yok.';
          modalTeslimTbody.innerHTML = '<tr><td colspan="8" class="px-4 py-2">' + emptyMsg + '</td></tr>';
          if (toplamEl) toplamEl.textContent = '0';
          return;
        }
        var miktarRaw = function (s) { var n = s.miktar != null ? Number(s.miktar) : 0; return isNaN(n) ? 0 : n; };
        teslimDisplayRows = visibleList.map(function (s) {
          var tarih = formatDate(s.satis_tarihi);
          var musteri = (s.musteri_adi || '—').replace(/</g, '&lt;');
          var stokRow = stokMap ? stokMap[s.fide_id] : null;
          var ekimStr = stokRow && stokRow.ekim_tarihi ? formatDate(stokRow.ekim_tarihi) : '—';
          var teslim = formatDate(s.teslim_tarihi);
          var total = miktarRaw(s);
          var del = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : 0;
          if (isNaN(del)) del = 0;
          var remaining = total - del;
          if (remaining < 0) remaining = 0;
          var notStr = (s.notlar || '—').replace(/</g, '&lt;');
          var cesitStr = stokRow && stokRow.cesit ? stokRow.cesit : '—';
          return { tarih: tarih, cesitStr: cesitStr, musteri: musteri, ekimStr: ekimStr, teslim: teslim, miktarNum: formatNum(remaining), miktarRaw: remaining, satisId: s.id || '', notStr: notStr, kargo: isKargo(s) };
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
          stokMap[row.id] = { cesit: row.cesit || '—', ekim_tarihi: row.ekim_tarihi };
        });
        fillTeslimDisplay(list, stokMap);
      });
    });
  }

  function resetTeslimFilters() {
    ['teslim-filter-kargo', 'teslim-filter-cesit', 'teslim-filter-musteri', 'teslim-filter-ekim', 'teslim-filter-teslim', 'teslim-filter-adet'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  function closeModalTeslim() {
    resetTeslimFilters();
    if (modalTeslim) {
      modalTeslim.classList.remove('open');
      modalTeslim.setAttribute('aria-hidden', 'true');
    }
  }

  function refreshTeslimModalIfOpen() {
    if (modalTeslim && modalTeslim.classList.contains('open')) openModalTeslim();
  }

  function openModalTeslimEdilenler() {
    if (modalTeslimEdilenlerTbody) {
      modalTeslimEdilenlerTbody.innerHTML = skeletonTableRows(TESLIM_EDILENLER_SKELETON_CELLS, SKELETON_DEFAULT_ROWS);
      modalTeslimEdilenlerTbody.setAttribute('aria-busy', 'true');
    }
    var toplamElEdilenler = document.getElementById('modal-teslim-edilenler-toplam');
    if (toplamElEdilenler) toplamElEdilenler.textContent = '0';
    if (modalTeslimEdilenler) {
      modalTeslimEdilenler.classList.add('open');
      modalTeslimEdilenler.setAttribute('aria-hidden', 'false');
    }
    if (!supabase || !modalTeslimEdilenlerTbody) {
      if (modalTeslimEdilenlerTbody) {
        modalTeslimEdilenlerTbody.removeAttribute('aria-busy');
        modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Bağlantı yok.</td></tr>';
      }
      return;
    }
    supabase.from('satislar').select('*').then(function (res) {
      if (res.error) {
        teslimEdilenlerDisplayRows = [];
        if (modalTeslimEdilenlerTbody) {
          modalTeslimEdilenlerTbody.removeAttribute('aria-busy');
          modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Veri alınamadı: ' +
            String(res.error.message || res.error).replace(/</g, '&lt;') + '</td></tr>';
        }
        if (toplamElEdilenler) toplamElEdilenler.textContent = '0';
        return;
      }
      var list = (res.data && res.data.slice()) || [];
      list = list.filter(function (s) {
        if (s.teslim_edildi_tarihi) return true;
        var del = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : 0;
        return !isNaN(del) && del > 0;
      });
      list.sort(function (a, b) { return tsTeslimEdildiSort(b) - tsTeslimEdildiSort(a); });
      if (list.length === 0) {
        teslimEdilenlerDisplayRows = [];
        if (modalTeslimEdilenlerTbody) modalTeslimEdilenlerTbody.removeAttribute('aria-busy');
        modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">Henüz teslim edilen kayıt yok.</td></tr>';
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
        if (modalTeslimEdilenlerTbody) modalTeslimEdilenlerTbody.removeAttribute('aria-busy');
        var visibleList = filterRowsByRelatedEkimCutoff(list, stokMap);
        if (visibleList.length === 0) {
          teslimEdilenlerDisplayRows = [];
          var emptyMsg = relatedRowsHiddenByEkimCutoff(list, stokMap)
            ? '1 Haziran 2026 öncesi teslim kayıtları gizli. Göstermek için «1 Haz. 2026 öncesini göster» kutusunu işaretleyin.'
            : 'Henüz teslim edilen kayıt yok.';
          modalTeslimEdilenlerTbody.innerHTML = '<tr><td colspan="7" class="px-4 py-2">' + emptyMsg + '</td></tr>';
          if (toplamElEdilenler) toplamElEdilenler.textContent = '0';
          return;
        }
        var miktarRaw = function (s) { var n = s.miktar != null ? Number(s.miktar) : 0; return isNaN(n) ? 0 : n; };
        teslimEdilenlerDisplayRows = visibleList.map(function (s) {
          var tarih = formatDate(s.teslim_edildi_tarihi || s.satis_tarihi);
          var musteri = (s.musteri_adi || '—').replace(/</g, '&lt;');
          var stokRow = stokMap ? stokMap[s.fide_id] : null;
          var ekimStr = stokRow && stokRow.ekim_tarihi ? formatDate(stokRow.ekim_tarihi) : '—';
          var teslim = formatDate(s.teslim_tarihi);
          var displayMiktar = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : miktarRaw(s);
          if (isNaN(displayMiktar)) displayMiktar = miktarRaw(s);
          var cesitStr = stokRow && stokRow.cesit ? stokRow.cesit : '—';
          return { tarih: tarih, tarihTs: tsTeslimEdildiSort(s), cesitStr: cesitStr, musteri: musteri, ekimStr: ekimStr, teslim: teslim, miktarNum: formatNum(displayMiktar), miktarRaw: displayMiktar, satisId: s.id || '', kargo: isKargo(s) };
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
          stokMap[row.id] = { cesit: row.cesit || '—', ekim_tarihi: row.ekim_tarihi };
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

  function refreshTeslimEdilenlerModalIfOpen() {
    if (modalTeslimEdilenler && modalTeslimEdilenler.classList.contains('open')) openModalTeslimEdilenler();
  }

  var btnTeslimFixed = document.getElementById('btn-teslim-fixed');
  if (btnTeslimFixed) btnTeslimFixed.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openModalTeslim(); });
  var btnTeslimEdilenlerFixed = document.getElementById('btn-teslim-edilenler-fixed');
  if (btnTeslimEdilenlerFixed) btnTeslimEdilenlerFixed.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openModalTeslimEdilenler(); });

  var modalTeslimAdet = document.getElementById('modal-teslim-adet');
  var teslimAdetMiktarInput = document.getElementById('teslim-adet-miktar');
  var teslimAdetBaslik = document.getElementById('modal-teslim-adet-baslik');
  var teslimAdetSatisId = null;
  var teslimAdetKismen = false;
  var teslimAdetMaxMiktar = NaN;

  function openModalTeslimAdet(satisId, adetStr, kismen) {
    teslimAdetSatisId = satisId;
    teslimAdetKismen = !!kismen;
    teslimAdetMaxMiktar = NaN;
    if (adetStr) {
      var mx = parseInt(String(adetStr).replace(/\D/g, ''), 10);
      if (!isNaN(mx)) teslimAdetMaxMiktar = mx;
    }
    if (teslimAdetBaslik) teslimAdetBaslik.textContent = kismen ? 'Kısmen teslim' : 'Kaç adet teslim edildi?';
    if (teslimAdetMiktarInput) {
      if (kismen) {
        teslimAdetMiktarInput.value = '';
        teslimAdetMiktarInput.placeholder = !isNaN(teslimAdetMaxMiktar) ? 'Maks. ' + formatNum(teslimAdetMaxMiktar) : 'Teslim edilen adet';
      } else {
        teslimAdetMiktarInput.value = adetStr || '';
        teslimAdetMiktarInput.placeholder = adetStr ? 'örn. ' + adetStr : 'örn. 10.000';
      }
    }
    if (modalTeslimAdet) {
      modalTeslimAdet.classList.add('open');
      modalTeslimAdet.setAttribute('aria-hidden', 'false');
    }
  }

  function closeModalTeslimAdet() {
    teslimAdetSatisId = null;
    teslimAdetKismen = false;
    teslimAdetMaxMiktar = NaN;
    if (teslimAdetBaslik) teslimAdetBaslik.textContent = 'Kaç adet teslim edildi?';
    if (teslimAdetMiktarInput) teslimAdetMiktarInput.value = '';
    if (modalTeslimAdet) {
      modalTeslimAdet.classList.remove('open');
      modalTeslimAdet.setAttribute('aria-hidden', 'true');
    }
  }

  if (modalTeslimTbody) {
    modalTeslimTbody.addEventListener('click', function (e) {
      var degistirBtn = e.target.closest('.btn-satis-degistir');
      if (degistirBtn) {
        e.preventDefault();
        e.stopPropagation();
        var sid = (degistirBtn.getAttribute('data-satis-id') || '').trim();
        if (sid) openModalSatisDegistir(sid);
        return;
      }
      var btnEt = e.target.closest('.btn-teslim-et');
      var btnKismi = e.target.closest('.btn-teslim-kismi');
      var btn = btnEt || btnKismi;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var satisId = (btn.getAttribute('data-satis-id') || '').trim();
      if (!satisId) return;
      var tr = btn.closest('tr');
      var adetStr = '';
      if (tr && tr.cells && tr.cells[3]) adetStr = (tr.cells[3].textContent || '').trim();
      openModalTeslimAdet(satisId, adetStr, !!btnKismi);
    });
  }

  document.querySelectorAll('[data-modal-close="teslim-adet"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslimAdet);
  });
  var btnTeslimAdetOnay = document.getElementById('btn-teslim-adet-onay');
  if (btnTeslimAdetOnay) {
    btnTeslimAdetOnay.addEventListener('click', function () {
      if (!teslimAdetSatisId || !supabase) return;
      var satisId = teslimAdetSatisId;
      var enteredStr = (teslimAdetMiktarInput && teslimAdetMiktarInput.value) ? String(teslimAdetMiktarInput.value).trim() : '';
      var enteredAmount = enteredStr === '' ? NaN : parseFormattedAdet(enteredStr);
      if (isNaN(enteredAmount) || enteredAmount < 0) enteredAmount = null;
      if (teslimAdetKismen) {
        if (enteredStr === '' || enteredAmount == null || isNaN(enteredAmount) || enteredAmount < 1) {
          openModalUyari('Kısmen teslim için teslim edilen adeti girin.');
          return;
        }
        if (!isNaN(teslimAdetMaxMiktar) && enteredAmount > teslimAdetMaxMiktar) {
          openModalUyari('Kalan adetten fazla giremezsiniz (maks. ' + formatNum(teslimAdetMaxMiktar) + ').');
          return;
        }
      }
      var unlock = submitLock(btnTeslimAdetOnay);
      supabase.from('satislar').select('miktar, teslim_edilen_miktar, musteri_adi, fide_id, teslim_tarihi').eq('id', satisId).maybeSingle().then(function (res) {
        var s = res.data;
        if (!s) {
          openModalUyari('Kayıt bulunamadı.');
          return;
        }
        var saleMiktar = s.miktar != null ? Number(s.miktar) : 0;
        if (isNaN(saleMiktar)) saleMiktar = 0;
        saleMiktar = Math.floor(saleMiktar);
        var already = s.teslim_edilen_miktar != null ? Number(s.teslim_edilen_miktar) : 0;
        if (isNaN(already)) already = 0;
        already = Math.floor(already);
        var remaining = saleMiktar - already;
        if (remaining < 1) {
          openModalUyari('Bu satırda teslim edilecek adet kalmadı.');
          return;
        }
        var teslimThis;
        if (teslimAdetKismen) {
          teslimThis = enteredAmount;
        } else if (enteredStr === '' || enteredAmount == null || isNaN(enteredAmount)) {
          teslimThis = remaining;
        } else {
          teslimThis = enteredAmount;
        }
        if (teslimThis < 1) {
          openModalUyari('En az 1 adet girin.');
          return;
        }
        if (teslimThis > remaining) {
          openModalUyari('Kalan adetten fazla giremezsiniz (kalan: ' + formatNum(remaining) + ').');
          return;
        }
        closeModalTeslimAdet();
        teslimThis = Math.floor(Number(teslimThis));
        var newDelivered = already + teslimThis;
        var nowIso = new Date().toISOString();
        var payload = {
          teslim_edildi_tarihi: nowIso,
          teslim_edilen_miktar: saleMiktar > 0 && newDelivered >= saleMiktar ? saleMiktar : newDelivered
        };
        return supabase.from('satislar').update(payload).eq('id', satisId).then(function (r) {
          if (r.error) { openModalUyari('Güncellenemedi: ' + (r.error.message || '')); return; }
          logIslem('Teslim', joinLogDetay([
            s.musteri_adi || '—',
            formatNum(teslimThis) + ' adet' + (teslimAdetKismen ? ' (kısmi)' : ''),
            'planlanan teslim ' + formatDate(s.teslim_tarihi),
            stokLogLabel(s.fide_id)
          ]));
          loadStok();
          refreshTeslimModalIfOpen();
          refreshKimeSatildiList();
          refreshTeslimEdilenlerModalIfOpen();
        });
      }).finally(unlock);
    });
  }

  document.querySelectorAll('[data-modal-close="teslim"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslim);
  });
  var btnTeslimExcel = document.getElementById('btn-teslim-excel');
  if (btnTeslimExcel) btnTeslimExcel.addEventListener('click', downloadTeslimExcel);
  if (modalTeslimEdilenlerTbody) {
    modalTeslimEdilenlerTbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-teslim-geri-al');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var satisId = (btn.getAttribute('data-satis-id') || '').trim();
      if (!satisId || !supabase) return;
      var unlock = submitLock(btn);
      supabase.from('satislar').select('musteri_adi, miktar, fide_id, teslim_tarihi, teslim_edilen_miktar').eq('id', satisId).maybeSingle().then(function (pre) {
        var s = pre.data || {};
        return supabase.from('satislar').update({ teslim_edildi_tarihi: null, teslim_edilen_miktar: null }).eq('id', satisId).then(function (r) {
          if (r.error) {
            openModalUyari('Güncellenemedi: ' + (r.error.message || ''));
            return;
          }
          logIslem('Teslim geri al', joinLogDetay([
            s.musteri_adi || '—',
            formatNum(s.teslim_edilen_miktar != null ? s.teslim_edilen_miktar : s.miktar) + ' adet',
            'teslim ' + formatDate(s.teslim_tarihi),
            stokLogLabel(s.fide_id)
          ]));
          openModalTeslimEdilenler();
        });
      }).finally(unlock);
    });
  }
  document.querySelectorAll('[data-modal-close="teslim-edilenler"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalTeslimEdilenler);
  });
  ['teslim-filter-kargo', 'teslim-filter-cesit', 'teslim-filter-musteri', 'teslim-filter-ekim', 'teslim-filter-teslim', 'teslim-filter-adet'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', renderTeslimTable);
  });
  ['teslim-edilenler-filter-tarih', 'teslim-edilenler-filter-cesit', 'teslim-edilenler-filter-musteri', 'teslim-edilenler-filter-ekim', 'teslim-edilenler-filter-teslim', 'teslim-edilenler-filter-adet'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', renderTeslimEdilenlerTable);
  });

  document.querySelectorAll('[data-modal-close="kime-satildi"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalKimeSatildi);
  });
  if (modalKimeSatildiBody) {
    modalKimeSatildiBody.addEventListener('click', function (e) {
      var teslimBtn = e.target.closest('.btn-teslim-et');
      if (teslimBtn) {
        e.preventDefault();
        e.stopPropagation();
        var teslimSatisId = (teslimBtn.getAttribute('data-satis-id') || '').trim();
        if (!teslimSatisId) return;
        var adetStr = (teslimBtn.getAttribute('data-kalan') || '').trim();
        openModalTeslimAdet(teslimSatisId, adetStr, false);
        return;
      }
      var iptalBtn = e.target.closest('.btn-satis-iptal');
      if (iptalBtn) {
        var satisId = (iptalBtn.getAttribute('data-satis-id') || '').trim();
        if (!satisId || !supabase) return;
        openModalOnay('Bu satışı iptal etmek istediğinize emin misiniz?', function () {
          supabase.from('satislar').select('fide_id, miktar, musteri_adi, teslim_tarihi, kargo, notlar').eq('id', satisId).maybeSingle().then(function (res) {
            var s = res.data || {};
            var fideId = s.fide_id || null;
            var miktar = (s.miktar != null) ? Number(s.miktar) : 0;
            var musteri = s.musteri_adi || '—';
            supabase.from('satislar').delete().eq('id', satisId).then(function (del) {
              if (del.error) {
                openModalUyari('Satış kaydı silinemedi: ' + (del.error.message || 'Yetki hatası olabilir.'));
                return;
              }
              logIslem('Satış iptal', joinLogDetay([
                musteri,
                formatNum(miktar) + ' adet',
                'teslim ' + formatDate(s.teslim_tarihi),
                stokLogLabel(fideId),
                s.kargo ? 'kargo' : '',
                s.notlar ? 'not: ' + s.notlar : ''
              ]));
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
        }, { confirmText: 'İptal et' });
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
  var aktarMusteri = '';
  var aktarKaynakEkim = '';

  function openModalSatisAktar(satisId) {
    if (!supabase || !satisId) return;
    aktarSatisId = satisId;
    if (satisAktarHedefEkim) {
      satisAktarHedefEkim.innerHTML = '<option value="">Yükleniyor...</option>';
      satisAktarHedefEkim.value = '';
      satisAktarHedefEkim.disabled = true;
    }
    if (modalSatisAktar) {
      modalSatisAktar.classList.add('open');
      modalSatisAktar.setAttribute('aria-hidden', 'false');
    }
    supabase.from('satislar').select('fide_id, miktar, musteri_adi').eq('id', satisId).maybeSingle().then(function (res) {
      if (res.error) {
        closeModalSatisAktar();
        openModalUyari('Satış bilgisi alınamadı: ' + supabaseErrorMsg(res.error));
        return;
      }
      var s = res.data;
      if (!s || !s.fide_id) {
        closeModalSatisAktar();
        openModalUyari('Satış kaydı bulunamadı.');
        return;
      }
      aktarFideId = s.fide_id;
      aktarMiktar = (s.miktar != null ? Number(s.miktar) : 0);
      aktarMusteri = s.musteri_adi ? String(s.musteri_adi) : '';
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi').eq('id', s.fide_id).maybeSingle().then(function (r2) {
        aktarCesit = (r2.data && r2.data.cesit) ? String(r2.data.cesit) : '';
        aktarKaynakEkim = (r2.data && r2.data.ekim_tarihi) ? r2.data.ekim_tarihi : '';
        supabase.from('fide_stok').select('id, ekim_tarihi, extra_fide').eq('cesit', aktarCesit).is('deleted_at', null).gt('extra_fide', 0).then(function (r3) {
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
            satisAktarHedefEkim.disabled = false;
            satisAktarHedefEkim.innerHTML = '<option value="">Seçin...</option>';
            dates.forEach(function (ekim) {
              var opt = document.createElement('option');
              opt.value = ekim;
              opt.textContent = formatDate(ekim);
              satisAktarHedefEkim.appendChild(opt);
            });
            satisAktarHedefEkim.focus();
          }
          if (dates.length === 0) {
            openModalUyari('Aktarılacak alternatif ekim tarihi bulunamadı.');
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
    aktarMusteri = '';
    aktarKaynakEkim = '';
    if (satisAktarHedefEkim) {
      satisAktarHedefEkim.disabled = false;
      satisAktarHedefEkim.innerHTML = '<option value="">Seçin...</option>';
    }
    if (modalSatisAktar) {
      modalSatisAktar.classList.remove('open');
      modalSatisAktar.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="satis-aktar"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSatisAktar);
  });
  var btnSatisAktarOnay = document.getElementById('btn-satis-aktar-onay');
  if (btnSatisAktarOnay) {
    btnSatisAktarOnay.addEventListener('click', function () {
      if (!aktarSatisId || !aktarFideId || !supabase) return;
      var hedefEkim = (satisAktarHedefEkim && satisAktarHedefEkim.value || '').trim();
      if (!hedefEkim) { openModalUyari('Hedef ekim tarihi seçin.'); return; }
      var unlock = submitLock(btnSatisAktarOnay);
      supabase.from('fide_stok').select('id, extra_fide').eq('ekim_tarihi', hedefEkim).eq('cesit', aktarCesit).is('deleted_at', null).limit(1).then(function (rNew) {
        var newRows = rNew.data && rNew.data.length ? rNew.data : [];
        var newStok = newRows[0];
        if (!newStok) {
          openModalUyari('Bu ekim tarihine ait stok kaydı bulunamadı.');
          return;
        }
        if (newStok.id === aktarFideId) {
          openModalUyari('Satış zaten bu gruba ait.');
          return;
        }
        var newExtra = (newStok.extra_fide != null ? Number(newStok.extra_fide) : 0);
        if (newExtra < aktarMiktar) {
          openModalUyari('Hedef stokta yeterli extra fide yok (' + newExtra + ').');
          return;
        }
        return supabase.from('fide_stok').select('extra_fide').eq('id', aktarFideId).maybeSingle().then(function (rOld) {
          var oldExtra = (rOld.data && rOld.data.extra_fide != null ? Number(rOld.data.extra_fide) : 0);
          var miktar = aktarMiktar;
          return supabase.from('fide_stok').update({ extra_fide: oldExtra + miktar }).eq('id', aktarFideId).then(function (a) {
            if (a.error) {
              openModalUyari('Satış aktarılamadı: ' + supabaseErrorMsg(a.error));
              return;
            }
            return supabase.from('fide_stok').update({ extra_fide: newExtra - miktar }).eq('id', newStok.id).then(function (b) {
              if (b.error) {
                return supabase.from('fide_stok').update({ extra_fide: oldExtra }).eq('id', aktarFideId).then(function () {
                  openModalUyari('Satış aktarılamadı. Stok geri alındı.');
                  loadStok();
                });
              }
              return supabase.from('satislar').update({ fide_id: newStok.id }).eq('id', aktarSatisId).then(function (c) {
                if (c.error) {
                  return Promise.all([
                    supabase.from('fide_stok').update({ extra_fide: oldExtra }).eq('id', aktarFideId),
                    supabase.from('fide_stok').update({ extra_fide: newExtra }).eq('id', newStok.id)
                  ]).then(function () {
                    openModalUyari('Satış aktarılamadı. Stok geri alındı: ' + supabaseErrorMsg(c.error));
                    loadStok();
                  });
                }
                logIslem('Satış aktar', joinLogDetay([
                  aktarMusteri || '—',
                  aktarCesit,
                  formatNum(miktar) + ' adet',
                  'ekim ' + formatDate(aktarKaynakEkim) + ' → ' + formatDate(hedefEkim)
                ]));
                closeModalSatisAktar();
                refreshKimeSatildiList();
                loadStok();
              });
            });
          });
        });
      }).finally(unlock);
    });
  }

  var satisDegistirModal = document.getElementById('modal-satis-degistir');
  var satisDegistirMusteri = document.getElementById('satis-degistir-musteri');
  var satisDegistirTeslim = document.getElementById('satis-degistir-teslim');
  var satisDegistirMiktar = document.getElementById('satis-degistir-miktar');
  var satisDegistirNotlar = document.getElementById('satis-degistir-notlar');
  var satisDegistirKargo = document.getElementById('satis-degistir-kargo');
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
      if (satisDegistirKargo) satisDegistirKargo.checked = isKargo(s);
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
  var btnSatisDegistirOnay = document.getElementById('btn-satis-degistir-onay');
  if (btnSatisDegistirOnay) {
    btnSatisDegistirOnay.addEventListener('click', function () {
      if (!editingSatisId || !supabase) return;
      var musteri = (satisDegistirMusteri && satisDegistirMusteri.value || '').trim();
      var teslim = (satisDegistirTeslim && satisDegistirTeslim.value || '').trim();
      var miktar = parseMiktar(satisDegistirMiktar && satisDegistirMiktar.value);
      if (!musteri) {
        openModalUyari('Müşteri ismi giriniz.');
        if (satisDegistirMusteri) satisDegistirMusteri.focus();
        return;
      }
      if (!teslim) {
        openModalUyari('Teslim tarihi giriniz.');
        if (satisDegistirTeslim) satisDegistirTeslim.focus();
        return;
      }
      if (miktar === null || miktar < 1) {
        openModalUyari('Kaç adet 1 veya daha fazla olmalıdır.');
        if (satisDegistirMiktar) satisDegistirMiktar.focus();
        return;
      }
      var notlar = (satisDegistirNotlar && satisDegistirNotlar.value || '').trim() || null;
      var kargo = !!(satisDegistirKargo && satisDegistirKargo.checked);
      var unlock = submitLock(btnSatisDegistirOnay);
      supabase.from('satislar').update({
        musteri_adi: musteri,
        teslim_tarihi: teslim,
        miktar: miktar,
        notlar: notlar,
        kargo: kargo
      }).eq('id', editingSatisId).then(function (res) {
        if (res.error) {
          openModalUyari('Satış güncellenemedi: ' + supabaseErrorMsg(res.error));
          return;
        }
        logIslem('Satış değiştir', joinLogDetay([
          musteri,
          formatNum(miktar) + ' adet',
          'teslim ' + formatDate(teslim),
          kargo ? 'kargo' : '',
          notlar ? 'not: ' + notlar : ''
        ]));
        closeModalSatisDegistir();
        refreshKimeSatildiList();
        refreshTeslimModalIfOpen();
        loadStok();
      }).finally(unlock);
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
  var btnSonrakineAktarOnay = document.getElementById('btn-sonrakine-aktar-onay');
  if (btnSonrakineAktarOnay) {
    btnSonrakineAktarOnay.addEventListener('click', function () {
      var id = sonrakineAktarPendingId;
      if (!id || !supabase) return;
      var unlock = submitLock(btnSonrakineAktarOnay);
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
        var curr = res.data;
        if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
          closeModalSonrakineAktarOnay();
          openModalUyari('Bu satırda aktarılacak extra fide yok.');
          return;
        }
        var cesit = (curr.cesit || '').trim();
        var ekim = curr.ekim_tarihi || '';
        var miktar = Number(curr.extra_fide);
        return supabase.from('fide_stok').select('id, extra_fide, ekim_tarihi').eq('cesit', cesit).is('deleted_at', null).gt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: true }).limit(1).then(function (r2) {
          var nextRows = (r2.data && r2.data.length) ? r2.data : [];
          var nextStok = nextRows[0];
          if (!nextStok) {
            closeModalSonrakineAktarOnay();
            openModalUyari('Sonraki ekim tarihine ait stok kaydı bulunamadı.');
            return;
          }
          var nextExtra = (nextStok.extra_fide != null ? Number(nextStok.extra_fide) : 0);
          return supabase.from('fide_stok').update({ extra_fide: 0 }).eq('id', id).then(function (a) {
            if (a.error) {
              closeModalSonrakineAktarOnay();
              openModalUyari('Aktarım yapılamadı: ' + supabaseErrorMsg(a.error));
              return;
            }
            return supabase.from('fide_stok').update({ extra_fide: nextExtra + miktar }).eq('id', nextStok.id).then(function (b) {
              if (b.error) {
                return supabase.from('fide_stok').update({ extra_fide: miktar }).eq('id', id).then(function () {
                  closeModalSonrakineAktarOnay();
                  openModalUyari('Aktarım yapılamadı. Kaynak stok geri alındı.');
                  loadStok();
                });
              }
              closeModalSonrakineAktarOnay();
              var hedefEkimSonraki = nextStok.ekim_tarihi;
              if (!hedefEkimSonraki) {
                var hedefRowS = stok.find(function (x) { return String(x.id) === String(nextStok.id); });
                if (hedefRowS) hedefEkimSonraki = hedefRowS.ekim_tarihi;
              }
              logIslem('Sonrakine aktar', joinLogDetay([
                cesit,
                formatNum(miktar) + ' extra fide',
                formatDate(ekim) + ' tarihli ekimden ' + formatDate(hedefEkimSonraki) + ' tarihli ekime'
              ]));
              markStokHareket(id);
              return supabase.from('extra_aktar_hareketleri').insert({
                kaynak_fide_id: id,
                hedef_fide_id: nextStok.id,
                miktar: miktar,
                tip: 'sonrakine'
              }).then(function () { loadStok(); }).catch(function () { loadStok(); });
            });
          });
        });
      }).finally(unlock);
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
  var btnOncekineAktarOnay = document.getElementById('btn-onceki-aktar-onay-confirm');
  if (btnOncekineAktarOnay) {
    btnOncekineAktarOnay.addEventListener('click', function () {
      var id = oncekineAktarPendingId;
      if (!id || !supabase) return;
      var unlock = submitLock(btnOncekineAktarOnay);
      supabase.from('fide_stok').select('id, cesit, ekim_tarihi, extra_fide').eq('id', id).maybeSingle().then(function (res) {
        var curr = res.data;
        if (!curr || curr.extra_fide == null || Number(curr.extra_fide) < 1) {
          closeModalOncekineAktarOnay();
          openModalUyari('Bu satırda aktarılacak extra fide yok.');
          return;
        }
        var cesit = (curr.cesit || '').trim();
        var ekim = curr.ekim_tarihi || '';
        var miktar = Number(curr.extra_fide);
        return supabase.from('fide_stok').select('id, extra_fide, ekim_tarihi').eq('cesit', cesit).is('deleted_at', null).lt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: false }).limit(1).then(function (r2) {
          var prevRows = (r2.data && r2.data.length) ? r2.data : [];
          var prevStok = prevRows[0];
          if (!prevStok) {
            closeModalOncekineAktarOnay();
            openModalUyari('Önceki ekim tarihine ait stok kaydı bulunamadı.');
            return;
          }
          var prevExtra = (prevStok.extra_fide != null ? Number(prevStok.extra_fide) : 0);
          return supabase.from('fide_stok').update({ extra_fide: 0 }).eq('id', id).then(function (a) {
            if (a.error) {
              closeModalOncekineAktarOnay();
              openModalUyari('Aktarım yapılamadı: ' + supabaseErrorMsg(a.error));
              return;
            }
            return supabase.from('fide_stok').update({ extra_fide: prevExtra + miktar }).eq('id', prevStok.id).then(function (b) {
              if (b.error) {
                return supabase.from('fide_stok').update({ extra_fide: miktar }).eq('id', id).then(function () {
                  closeModalOncekineAktarOnay();
                  openModalUyari('Aktarım yapılamadı. Kaynak stok geri alındı.');
                  loadStok();
                });
              }
              closeModalOncekineAktarOnay();
              var hedefEkimOnceki = prevStok.ekim_tarihi;
              if (!hedefEkimOnceki) {
                var hedefRowO = stok.find(function (x) { return String(x.id) === String(prevStok.id); });
                if (hedefRowO) hedefEkimOnceki = hedefRowO.ekim_tarihi;
              }
              logIslem('Öncekine aktar', joinLogDetay([
                cesit,
                formatNum(miktar) + ' extra fide',
                formatDate(ekim) + ' tarihli ekimden ' + formatDate(hedefEkimOnceki) + ' tarihli ekime'
              ]));
              markStokHareket(id);
              return supabase.from('extra_aktar_hareketleri').insert({
                kaynak_fide_id: id,
                hedef_fide_id: prevStok.id,
                miktar: miktar,
                tip: 'oncekine'
              }).then(function () { loadStok(); }).catch(function () { loadStok(); });
            });
          });
        });
      }).finally(unlock);
    });
  }

  var copFideId = null;
  var copFideMaxExtra = 0;
  var modalCop = document.getElementById('modal-cop');
  var copMiktarEl = document.getElementById('cop-miktar');

  function openModalCop(fideId) {
    copFideId = fideId;
    copFideMaxExtra = 0;
    var row = stok.find(function (r) { return String(r.id) === String(fideId); });
    if (row && row.extra_fide != null && !isNaN(Number(row.extra_fide))) {
      copFideMaxExtra = Math.max(0, Math.floor(Number(row.extra_fide)));
    }
    if (copMiktarEl) copMiktarEl.value = '';
    if (modalCop) {
      modalCop.classList.add('open');
      modalCop.setAttribute('aria-hidden', 'false');
      if (copMiktarEl) copMiktarEl.focus();
    }
  }

  function closeModalCop() {
    copFideId = null;
    copFideMaxExtra = 0;
    if (modalCop) {
      modalCop.classList.remove('open');
      modalCop.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="cop"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCop);
  });
  if (copMiktarEl) {
    copMiktarEl.addEventListener('input', function () {
      this.value = formatMiktarBinlik(this.value);
    });
  }
  var btnCopHepsini = document.getElementById('btn-cop-hepsini');
  if (btnCopHepsini) {
    btnCopHepsini.addEventListener('click', function () {
      if (!copFideId) return;
      if (copFideMaxExtra < 1) {
        openModalUyari('Bu satırda çöpe atılacak extra fide yok.');
        return;
      }
      if (copMiktarEl) {
        copMiktarEl.value = formatMiktarBinlik(String(copFideMaxExtra));
        copMiktarEl.focus();
      }
    });
  }
  document.querySelectorAll('[data-modal-close="cop-kaydi"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCopKaydi);
  });
  document.querySelectorAll('[data-modal-close="silinenler"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalSilinenler);
  });
  var btnToolbarSilinenler = document.getElementById('btn-toolbar-silinenler');
  if (btnToolbarSilinenler) {
    btnToolbarSilinenler.addEventListener('click', function () { openModalSilinenler(); });
  }
  var modalSilinenlerBody = document.getElementById('modal-silinenler-body');
  if (modalSilinenlerBody) {
    modalSilinenlerBody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-silinen-geri-al');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (!id) return;
      openModalOnay('Bu kayıt geri alınacak ve stok listesine dönecek. Emin misiniz?', function () {
        var unlock = submitLock(btn);
        supabase.from('fide_stok').select('cesit, ekim_tarihi, ekim_no, ekilen_miktar, extra_fide').eq('id', id).maybeSingle().then(function (pre) {
          var row = pre.data || {};
          restoreStokById(id, function (res) {
            try {
              if (!res.error) {
                logIslem('Stok geri al', joinLogDetay([
                  stokLogLabel(row) || ('id ' + id),
                  formatNum(row.ekilen_miktar) + ' viyol',
                  'extra ' + formatNum(row.extra_fide)
                ]));
                refreshSilinenlerModalIfOpen();
                loadStok();
              } else {
                var msg = (res.error && res.error.message) ? res.error.message : 'Geri alınamadı.';
                openModalUyari('Geri alınamadı: ' + msg);
              }
            } finally {
              unlock();
            }
          });
        });
      }, { confirmText: 'Geri al' });
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
  var btnSilOnay = document.getElementById('btn-sil-onay');
  if (btnSilOnay) {
    btnSilOnay.addEventListener('click', function () {
      var id = silOnayPendingId;
      closeModalSilOnay();
      if (!id || !supabase) return;
      var unlock = submitLock(btnSilOnay);
      var silRow = stok.find(function (x) { return String(x.id) === String(id); });
      var silDetay = silRow
        ? joinLogDetay([
          stokLogLabel(silRow),
          formatNum(silRow.ekilen_miktar) + ' viyol',
          'extra ' + formatNum(silRow.extra_fide)
        ])
        : ('id ' + id);
      softDeleteStokByIds([id], function (res) {
        try {
          if (!res.error) {
            logIslem('Stok silme', silDetay);
            refreshSilinenlerModalIfOpen();
            loadStok();
          } else {
            var msg = (res.error && res.error.message) ? res.error.message : 'Silme yapılamadı.';
            if (/deleted_at/i.test(msg)) {
              openModalUyari('Silme için deleted_at kolonu gerekir. Supabase’de meldus/sql/fide_stok_soft_delete.sql çalıştırın.');
            } else {
              openModalUyari('Silinemedi: ' + msg);
            }
          }
        } finally {
          unlock();
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
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (!modalUyari || !modalUyari.classList.contains('open')) return;
    e.preventDefault();
    closeModalUyari();
  });

  var modalOnay = document.getElementById('modal-onay');
  var modalOnayMesaj = document.getElementById('modal-onay-mesaj');
  var btnOnayEvet = document.getElementById('btn-onay-evet');
  var onayPendingFn = null;
  function openModalOnay(msg, onConfirm, opts) {
    opts = opts || {};
    onayPendingFn = typeof onConfirm === 'function' ? onConfirm : null;
    if (modalOnayMesaj) modalOnayMesaj.textContent = msg || '';
    if (btnOnayEvet) btnOnayEvet.textContent = opts.confirmText || 'Onayla';
    if (modalOnay) { modalOnay.classList.add('open'); modalOnay.setAttribute('aria-hidden', 'false'); }
  }
  function closeModalOnay() {
    onayPendingFn = null;
    if (modalOnay) { modalOnay.classList.remove('open'); modalOnay.setAttribute('aria-hidden', 'true'); }
  }
  if (btnOnayEvet) {
    btnOnayEvet.addEventListener('click', function () {
      var fn = onayPendingFn;
      closeModalOnay();
      if (fn) fn();
    });
  }
  document.querySelectorAll('[data-modal-close="onay"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalOnay);
  });

  var copKaydiDegistirId = null;
  var copKaydiDegistirFideId = null;
  var copKaydiDegistirOldMiktar = 0;
  var modalCopKaydiDegistir = document.getElementById('modal-cop-kaydi-degistir');
  var copKaydiDegistirMiktarEl = document.getElementById('cop-kaydi-degistir-miktar');

  function openModalCopKaydiDegistir(copId, fideId, oldMiktar) {
    copKaydiDegistirId = copId;
    copKaydiDegistirFideId = fideId;
    copKaydiDegistirOldMiktar = oldMiktar;
    if (copKaydiDegistirMiktarEl) copKaydiDegistirMiktarEl.value = oldMiktar > 0 ? String(oldMiktar) : '';
    if (modalCopKaydiDegistir) {
      modalCopKaydiDegistir.classList.add('open');
      modalCopKaydiDegistir.setAttribute('aria-hidden', 'false');
      if (copKaydiDegistirMiktarEl) copKaydiDegistirMiktarEl.focus();
    }
  }

  function closeModalCopKaydiDegistir() {
    copKaydiDegistirId = null;
    copKaydiDegistirFideId = null;
    copKaydiDegistirOldMiktar = 0;
    if (modalCopKaydiDegistir) {
      modalCopKaydiDegistir.classList.remove('open');
      modalCopKaydiDegistir.setAttribute('aria-hidden', 'true');
    }
  }

  var copKaydiSilCopId = null;
  var copKaydiSilFideId = null;
  var copKaydiSilMiktar = 0;
  var modalCopKaydiSil = document.getElementById('modal-cop-kaydi-sil');

  function openModalCopKaydiSil(copId, fideId, miktar) {
    copKaydiSilCopId = copId;
    copKaydiSilFideId = fideId;
    copKaydiSilMiktar = miktar;
    if (modalCopKaydiSil) {
      modalCopKaydiSil.classList.add('open');
      modalCopKaydiSil.setAttribute('aria-hidden', 'false');
    }
  }

  function closeModalCopKaydiSil() {
    copKaydiSilCopId = null;
    copKaydiSilFideId = null;
    copKaydiSilMiktar = 0;
    if (modalCopKaydiSil) {
      modalCopKaydiSil.classList.remove('open');
      modalCopKaydiSil.setAttribute('aria-hidden', 'true');
    }
  }

  document.querySelectorAll('[data-modal-close="cop-kaydi-degistir"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCopKaydiDegistir);
  });
  document.querySelectorAll('[data-modal-close="cop-kaydi-sil"]').forEach(function (btn) {
    btn.addEventListener('click', closeModalCopKaydiSil);
  });

  document.addEventListener('click', function (e) {
    var bDeg = e.target.closest('.btn-cop-kaydi-degistir');
    if (bDeg) {
      var cid = bDeg.getAttribute('data-cop-id');
      var fid = bDeg.getAttribute('data-fide-id');
      var mm = Number(bDeg.getAttribute('data-miktar'));
      if (cid && fid) openModalCopKaydiDegistir(cid, fid, isNaN(mm) ? 0 : mm);
      return;
    }
    var bSil = e.target.closest('.btn-cop-kaydi-sil');
    if (bSil) {
      var cid2 = bSil.getAttribute('data-cop-id');
      var fid2 = bSil.getAttribute('data-fide-id');
      var mm2 = Number(bSil.getAttribute('data-miktar'));
      if (cid2 && fid2) openModalCopKaydiSil(cid2, fid2, isNaN(mm2) ? 0 : mm2);
    }
  });

  var btnCopKaydiDegistirOnay = document.getElementById('btn-cop-kaydi-degistir-onay');
  if (btnCopKaydiDegistirOnay) {
    btnCopKaydiDegistirOnay.addEventListener('click', function () {
      if (!copKaydiDegistirId || !copKaydiDegistirFideId || !supabase) return;
      var newM = parseMiktar(copKaydiDegistirMiktarEl && copKaydiDegistirMiktarEl.value);
      if (newM === null || newM < 1) {
        openModalUyari('Miktar 1 veya daha fazla olmalıdır.');
        return;
      }
      var oldM = copKaydiDegistirOldMiktar;
      var delta = newM - oldM;
      var unlock = submitLock(btnCopKaydiDegistirOnay);
      supabase.from('fide_stok').select('extra_fide').eq('id', copKaydiDegistirFideId).maybeSingle().then(function (r) {
        var extra = (r.data && r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
        if (isNaN(extra)) extra = 0;
        var newExtra = extra - delta;
        if (newExtra < 0) {
          openModalUyari('Stokta yeterli extra fide yok (mevcut: ' + extra + ', gerekli ek düşüş: ' + delta + ').');
          return;
        }
        return supabase.from('cop_kayitlari').update({ miktar: newM }).eq('id', copKaydiDegistirId).then(function (up) {
          if (up.error) {
            openModalUyari('Güncellenemedi.');
            return;
          }
          return supabase.from('fide_stok').update({ extra_fide: newExtra }).eq('id', copKaydiDegistirFideId).then(function (u2) {
            if (u2.error) {
              openModalUyari('Stok güncellenemedi.');
              return;
            }
            logIslem('Çöp değiştir', joinLogDetay([
              stokLogLabel(copKaydiDegistirFideId),
              formatNum(oldM) + ' → ' + formatNum(newM) + ' adet'
            ]));
            closeModalCopKaydiDegistir();
            loadStok();
            loadCop();
            refreshCopKaydiModalIfOpen();
          });
        });
      }).finally(unlock);
    });
  }

  var btnCopKaydiSilOnay = document.getElementById('btn-cop-kaydi-sil-onay');
  if (btnCopKaydiSilOnay) {
    btnCopKaydiSilOnay.addEventListener('click', function () {
      var cid = copKaydiSilCopId;
      var fid = copKaydiSilFideId;
      var m = copKaydiSilMiktar;
      closeModalCopKaydiSil();
      if (!cid || !fid || !supabase) return;
      var unlock = submitLock(btnCopKaydiSilOnay);
      supabase.from('cop_kayitlari').delete().eq('id', cid).then(function (del) {
        if (del.error) {
          openModalUyari('Silinemedi: kayıt bağımlılığı olabilir.');
          return;
        }
        return supabase.from('fide_stok').select('extra_fide').eq('id', fid).maybeSingle().then(function (r) {
          var extra = (r.data && r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
          if (isNaN(extra)) extra = 0;
          return supabase.from('fide_stok').update({ extra_fide: extra + m }).eq('id', fid).then(function (u) {
            if (u.error) openModalUyari('Stok güncellenemedi.');
            logIslem('Çöp silme', joinLogDetay([
              stokLogLabel(fid),
              formatNum(m) + ' adet çöp kaydı silindi (extra’ya geri eklendi)'
            ]));
            loadStok();
            loadCop();
            refreshCopKaydiModalIfOpen();
          });
        });
      }).finally(unlock);
    });
  }

  var btnCopOnay = document.getElementById('btn-cop-onay');
  if (btnCopOnay) {
    btnCopOnay.addEventListener('click', function () {
      if (!copFideId || !supabase) return;
      var miktar = parseMiktar(copMiktarEl && copMiktarEl.value);
      if (miktar === null || miktar < 1) {
        openModalUyari('Çöpe atılacak miktar 1 veya daha fazla olmalıdır.');
        return;
      }
      var unlock = submitLock(btnCopOnay);
      supabase.from('fide_stok').select('extra_fide').eq('id', copFideId).maybeSingle().then(function (r) {
        var extra = (r.data && r.data.extra_fide != null ? Number(r.data.extra_fide) : 0);
        if (miktar > extra) {
          openModalUyari('Stokta yeterli extra fide yok (mevcut: ' + extra + ').');
          return;
        }
        return supabase.from('cop_kayitlari').insert({ fide_id: copFideId, miktar: miktar }).then(function (res) {
          if (res.error) {
            openModalUyari('Çöp kaydı eklenemedi: ' + supabaseErrorMsg(res.error));
            return;
          }
          return supabase.from('fide_stok').update({ extra_fide: extra - miktar }).eq('id', copFideId).then(function (u) {
            closeModalCop();
            if (u.error) {
              openModalUyari('Çöp kaydı eklendi ama stok düşülemedi: ' + supabaseErrorMsg(u.error));
            }
            logIslem('Çöpe at', joinLogDetay([
              stokLogLabel(copFideId),
              formatNum(miktar) + ' adet fire'
            ]));
            markStokHareket(copFideId);
            loadStok();
            loadCop();
            refreshCopKaydiModalIfOpen();
          });
        });
      }).finally(unlock);
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
            supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).is('deleted_at', null).gt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: true }).limit(1).then(function (r2) {
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
            supabase.from('fide_stok').select('id, extra_fide').eq('cesit', cesit).is('deleted_at', null).lt('ekim_tarihi', ekim).order('ekim_tarihi', { ascending: false }).limit(1).then(function (r2) {
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
      var btnHareketler = e.target.closest('.btn-hareketler');
      if (btnHareketler) {
        id = btnHareketler.getAttribute('data-id');
        if (id) openModalStokHareketler(id);
        return;
      }
    });
  }

  function switchMainView(v) {
    document.querySelectorAll('.panel-nav[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === v);
    });
    document.querySelectorAll('main.panel-main section[data-view]').forEach(function (sec) {
      sec.classList.toggle('active', sec.getAttribute('data-view') === v);
    });
  }

  document.querySelectorAll('.panel-nav[data-view]').forEach(function (navBtn) {
    navBtn.addEventListener('click', function () {
      var view = navBtn.getAttribute('data-view');
      if (!view) return;
      switchMainView(view);
      if (view === 'cop') loadCop();
    });
  });

  var btnToolbarCop = document.getElementById('btn-toolbar-cop');
  if (btnToolbarCop) {
    btnToolbarCop.addEventListener('click', function () { openModalCopKaydi(); });
  }

  function startMeldusApp() {
    loadCesitTanimlari();
    renderCesitFilters();
    loadStok();
  }
  if (window.meldusAuth && typeof window.meldusAuth.whenReady === 'function') {
    window.meldusAuth.whenReady(startMeldusApp);
  } else {
    startMeldusApp();
  }
})();
