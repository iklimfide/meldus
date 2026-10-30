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
  if (userLabel) userLabel.textContent = window.meldusAuth.getUser() || 'arif';

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
    var result = window.meldusAuth.updateUser(oldName, fields);
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
    renderUsers();
  }

  function renderUsers() {
    if (!usersTbody) return;
    var rows = [];
    rows.push(
      '<tr>' +
        '<td><strong>arif</strong></td>' +
        '<td><span class="badge-master">Master</span></td>' +
        '<td>—</td>' +
      '</tr>'
    );
    var list = window.meldusAuth.loadUsers ? window.meldusAuth.loadUsers() : [];
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
        window.meldusAuth.deleteUser(uname);
        renderUsers();
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

  renderUsers();

  function loadLogs() {
    if (!logsTbody) return;
    var supabase = null;
    if (typeof window.SUPABASE_URL !== 'undefined' && typeof window.SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
      supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    if (!supabase) {
      logsTbody.innerHTML = '<tr><td colspan="4" class="empty">Veritabanı bağlantısı yok.</td></tr>';
      return;
    }
    supabase.from('meldus_islem_log').select('kullanici, islem, detay, created_at').order('created_at', { ascending: false }).limit(300).then(function (res) {
      if (res.error) {
        logsTbody.innerHTML = '<tr><td colspan="4" class="empty">Log yüklenemedi. <code>meldus_islem_log</code> tablosunu oluşturduğunuzdan emin olun.</td></tr>';
        return;
      }
      var rows = res.data || [];
      if (!rows.length) {
        logsTbody.innerHTML = '<tr><td colspan="4" class="empty">Henüz işlem kaydı yok.</td></tr>';
        return;
      }
      logsTbody.innerHTML = rows.map(function (r) {
        return '<tr>' +
          '<td>' + esc(formatDateTime(r.created_at)) + '</td>' +
          '<td>' + esc(r.kullanici || '—') + '</td>' +
          '<td>' + esc(r.islem || '—') + '</td>' +
          '<td>' + esc(r.detay || '—') + '</td>' +
          '</tr>';
      }).join('');
    });
  }

  loadLogs();
})();
