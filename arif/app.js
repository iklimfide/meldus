(function () {
  'use strict';

  var denied = document.getElementById('arif-denied');
  var app = document.getElementById('arif-app');
  var usersTbody = document.getElementById('arif-users-tbody');
  var logsTbody = document.getElementById('arif-logs-tbody');
  var userLabel = document.getElementById('arif-user-label');
  var btnLogout = document.getElementById('arif-logout');
  var editModal = document.getElementById('arif-edit-modal');
  var editOld = document.getElementById('arif-edit-old');
  var editUser = document.getElementById('arif-edit-user');
  var editPass = document.getElementById('arif-edit-pass');
  var editErr = document.getElementById('arif-edit-error');
  var editCancel = document.getElementById('arif-edit-cancel');
  var editSave = document.getElementById('arif-edit-save');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseOzetSatir(part) {
    var m = {};
    String(part || '').split(';').forEach(function (bit) {
      var i = bit.indexOf('=');
      if (i < 1) return;
      m[bit.slice(0, i).trim()] = bit.slice(i + 1).trim();
    });
    return m;
  }

  function satirKimligi(onceMap, sonraMap, prefix) {
    var m = (sonraMap && Object.keys(sonraMap).length) ? sonraMap : (onceMap || {});
    var bits = [];
    if (m['Çeşit'] && m['Çeşit'] !== '—') bits.push(m['Çeşit']);
    if (m['Ekim tarihi'] && m['Ekim tarihi'] !== '—') bits.push('ekim ' + m['Ekim tarihi']);
    if (m['Ekim no'] && m['Ekim no'] !== '—') bits.push('ekim no ' + m['Ekim no']);
    if (m['Adres'] && m['Adres'] !== '—') bits.push('adres ' + m['Adres']);
    if (bits.length) return bits.join(' · ');
    var p = String(prefix || '').replace(/^id\s+[0-9a-f-]{8,}[·\s]*/i, '').trim();
    return p || '—';
  }

  function okHtml(eski, yeni) {
    return '<span class="log-eski">' + esc(eski) + '</span> → <span class="log-yeni">' + esc(yeni) + '</span>';
  }

  function okParcaHtml(p) {
    var m = String(p || '').match(/^(.*?)\s→\s(.*)$/);
    if (!m) return esc(p);
    return okHtml(m[1], m[2]);
  }

  function alanBos(k, v) {
    var sayi = k === 'Ekilen' || k === 'Çıkan' || k === 'Extra';
    if (v == null || v === '' || v === '—') return sayi ? '0' : '—';
    return v;
  }

  function alanFarklari(onceMap, sonraMap) {
    var keys = ['Çeşit', 'Ekim tarihi', 'Ekim no', 'Teslim tarihi', 'Ekilen', 'Çıkan', 'Extra', 'Adres'];
    var lines = [];
    keys.forEach(function (k) {
      var a = alanBos(k, onceMap && onceMap[k]);
      var b = alanBos(k, sonraMap && sonraMap[k]);
      if (a !== b || k === 'Extra') lines.push(esc(k) + ': ' + okHtml(a, b));
    });
    return lines.length ? lines.join('\n') : okHtml('0', '0');
  }

  var ISLEM_MODAL = {
    'Yeni kayıt': 'Yeni kayıt',
    'Kayıt değiştir': 'Kayıt değiştir',
    'Satış': 'SATIŞ YAP',
    'Satış iptal': 'Kime satıldı',
    'Satış değiştir': 'Satış değiştir',
    'Satış aktar': 'Satışı aktar',
    'Sipariş kapandı': 'Kime satıldı',
    'Teslim': 'Teslim Edilecekler',
    'Teslim geri al': 'Teslim Edilenler',
    'Stok silme': 'Kayıt sil',
    'Toplu silme': 'Kayıt sil',
    'Stok geri al': 'Silinenler',
    'Çöpe at': 'FİRE KAYDI',
    'Çöp değiştir': 'Çöp kaydını düzenle',
    'Çöp geri al': 'Çöp kaydı',
    'Sonrakine aktar': 'Sonrakine aktar',
    'Öncekine aktar': 'Öncekine aktar',
    'Aktarım geri al': 'Hareketler'
  };

  function modalAdi(islem) {
    var key = String(islem || '').trim();
    return ISLEM_MODAL[key] || key || '—';
  }

  function splitLogDetay(detay) {
    var s = String(detay == null ? '' : detay).trim();
    if (!s) return { satir: '—', degisim: '—' };
    var idxOnce = s.search(/önce:\s*/i);
    var idxSonra = s.search(/·\s*sonra:\s*/i);
    if (idxOnce >= 0 && idxSonra > idxOnce) {
      var prefix = s.slice(0, idxOnce).replace(/[·\s]+$/, '').trim();
      var rest = s.slice(idxOnce).replace(/^önce:\s*/i, '');
      var m = rest.match(/^(.*?)\s*·\s*sonra:\s*(.*)$/i);
      if (m) {
        var onceMap = parseOzetSatir(m[1]);
        var sonraMap = parseOzetSatir(m[2]);
        return {
          satir: satirKimligi(onceMap, sonraMap, prefix),
          degisim: alanFarklari(onceMap, sonraMap)
        };
      }
    }
    var parts = s.split(/\s*·\s*/);
    var satir = [];
    var degisim = [];
    parts.forEach(function (p) {
      if (/\s→\s/.test(p)) degisim.push(p);
      else satir.push(p);
    });
    if (degisim.length) {
      return {
        satir: satir.filter(Boolean).join(' · ') || '—',
        degisim: degisim.map(okParcaHtml).join('\n')
      };
    }
    return { satir: s, degisim: '—' };
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  if (!window.meldusAuth || !window.meldusAuth.isMaster || !window.meldusAuth.isMaster()) {
    if (denied) denied.hidden = false;
    if (app) app.hidden = true;
    return;
  }

  if (denied) denied.hidden = true;
  if (app) app.hidden = false;
  if (userLabel) userLabel.textContent = window.meldusAuth.getUser() || 'ARİF';

  if (btnLogout) {
    btnLogout.addEventListener('click', function () {
      if (window.meldusAuth.setSession) window.meldusAuth.setSession('');
      window.location.href = '/meldus/';
    });
  }

  function showEditError(msg) {
    if (!editErr) return;
    editErr.textContent = msg || '';
    editErr.hidden = !msg;
  }

  function openEditModal(username) {
    var row = window.meldusAuth.findUser ? window.meldusAuth.findUser(username) : null;
    if (!row) return;
    if (editOld) editOld.value = row.username || '';
    if (editUser) editUser.value = row.username || '';
    if (editPass) editPass.value = '';
    showEditError('');
    if (editModal) {
      editModal.classList.add('open');
      editModal.setAttribute('aria-hidden', 'false');
    }
    if (editUser) editUser.focus();
  }

  function closeEditModal() {
    if (editModal) {
      editModal.classList.remove('open');
      editModal.setAttribute('aria-hidden', 'true');
    }
  }

  function saveEdit() {
    var oldName = editOld ? editOld.value : '';
    var newName = editUser ? editUser.value : '';
    var newPass = editPass ? editPass.value : '';
    var fields = { username: newName };
    if (String(newPass || '').trim() !== '') fields.password = newPass;
    Promise.resolve(window.meldusAuth.updateUser(oldName, fields)).then(function (result) {
      if (!result || !result.ok) {
        var map = {
          master: 'Master hesabı düzenlenemez.',
          missing: 'Kullanıcı bulunamadı.',
          'user-short': 'Kullanıcı adı en az 2 karakter olmalı.',
          'user-chars': 'Kullanıcı adında sadece harf, rakam, . _ - kullanın.',
          reserved: 'Bu kullanıcı adı kullanılamaz.',
          taken: 'Bu kullanıcı adı zaten kayıtlı.',
          'pass-short': 'Şifre en az 4 karakter olmalı.'
        };
        showEditError((result && map[result.reason]) || 'Güncellenemedi.');
        return;
      }
      closeEditModal();
      reloadUsers();
    }).catch(function () {
      showEditError('Güncellenemedi.');
    });
  }

  function renderUsers(list) {
    if (!usersTbody) return;
    var rows = [];
    rows.push(
      '<tr>' +
        '<td><strong>ARİF</strong></td>' +
        '<td><span class="badge-master">Master</span></td>' +
        '<td>—</td>' +
      '</tr>'
    );
    if (!list) list = window.meldusAuth.loadUsers ? window.meldusAuth.loadUsers() : [];
    if (!list.length) {
      rows.push('<tr><td colspan="3" class="empty">Henüz kayıtlı başka kullanıcı yok.</td></tr>');
    } else {
      list.forEach(function (u) {
        var name = esc(u.username || '');
        rows.push(
          '<tr data-user="' + name + '">' +
            '<td>' + name + '</td>' +
            '<td>Kullanıcı</td>' +
            '<td>' +
              '<button type="button" class="btn-muted" data-edit="' + name + '">Düzenle</button>' +
              '<button type="button" class="btn-danger" data-delete="' + name + '">Sil</button>' +
            '</td>' +
          '</tr>'
        );
      });
    }
    usersTbody.innerHTML = rows.join('');
  }

  function reloadUsers() {
    if (usersTbody) usersTbody.innerHTML = '<tr><td colspan="3" class="empty">Yükleniyor…</td></tr>';
    var ready = window.meldusAuth.refreshUsers
      ? window.meldusAuth.refreshUsers()
      : Promise.resolve(window.meldusAuth.loadUsers ? window.meldusAuth.loadUsers() : []);
    ready.then(renderUsers).catch(function () {
      if (usersTbody) {
        usersTbody.innerHTML = '<tr><td colspan="3" class="empty">Kullanıcılar yüklenemedi. Supabase’de <code>users</code> tablosunu oluşturun (meldus/sql/users.sql).</td></tr>';
      }
    });
  }

  if (usersTbody) {
    usersTbody.addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit]');
      if (edit) {
        openEditModal(edit.getAttribute('data-edit'));
        return;
      }
      var del = e.target.closest('[data-delete]');
      if (del) {
        var uname = del.getAttribute('data-delete');
        if (!uname) return;
        if (!window.confirm('«' + uname + '» kullanıcısı silinsin mi?')) return;
        Promise.resolve(window.meldusAuth.deleteUser(uname)).then(reloadUsers).catch(function () {
          window.alert('Kullanıcı silinemedi.');
        });
      }
    });
  }

  if (editCancel) editCancel.addEventListener('click', closeEditModal);
  if (editSave) editSave.addEventListener('click', saveEdit);
  if (editModal) {
    editModal.addEventListener('click', function (e) {
      if (e.target === editModal) closeEditModal();
    });
  }
  [editUser, editPass].forEach(function (el) {
    if (!el) return;
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); closeEditModal(); }
    });
  });

  reloadUsers();

  function loadLogs() {
    if (!logsTbody) return;
    var supabase = null;
    if (typeof window.SUPABASE_URL !== 'undefined' && typeof window.SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
      supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    if (!supabase) {
      logsTbody.innerHTML = '<tr><td colspan="5" class="empty">Veritabanı bağlantısı yok.</td></tr>';
      return;
    }
    supabase.from('meldus_islem_log').select('kullanici, islem, detay, created_at').order('created_at', { ascending: false }).limit(300).then(function (res) {
      if (res.error) {
        logsTbody.innerHTML = '<tr><td colspan="5" class="empty">Log yüklenemedi. <code>meldus_islem_log</code> tablosunu oluşturduğunuzdan emin olun.</td></tr>';
        return;
      }
      var rows = res.data || [];
      if (!rows.length) {
        logsTbody.innerHTML = '<tr><td colspan="5" class="empty">Henüz işlem kaydı yok.</td></tr>';
        return;
      }
      logsTbody.innerHTML = rows.map(function (r) {
        var split = splitLogDetay(r.detay);
        return '<tr>' +
          '<td>' + esc(formatDateTime(r.created_at)) + '</td>' +
          '<td>' + esc(r.kullanici || '—') + '</td>' +
          '<td>' + esc(modalAdi(r.islem)) + '</td>' +
          '<td>' + esc(split.satir) + '</td>' +
          '<td>' + (split.degisim || '—') + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  loadLogs();
})();
