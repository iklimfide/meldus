(function () {
  'use strict';

  /** Meraklı göz engeli — gerçek güvenlik değildir. */
  var REGISTER_CODE = (typeof window.MELDUS_REGISTER_CODE !== 'undefined' && window.MELDUS_REGISTER_CODE)
    ? String(window.MELDUS_REGISTER_CODE)
    : 'iklim2026';
  var MASTER_USER = 'arif';
  var MASTER_PASS = '5391';
  var USERS_KEY = 'meldus-local-users';
  var SESSION_KEY = 'meldus-local-session';
  var USERS_TABLE = 'users';
  var readyCallbacks = [];
  var started = false;
  var usersCache = [];
  var supabaseClient = null;

  function normalizeUser(name) {
    return String(name || '').trim().toLowerCase();
  }

  function getClient() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.SUPABASE_URL === 'undefined' || typeof window.SUPABASE_ANON_KEY === 'undefined' || !window.supabase) {
      return null;
    }
    supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  function dbErrorMessage(err) {
    var msg = err && (err.message || err.details || err.hint) ? String(err.message || err.details || err.hint) : '';
    if (/relation.*users.*does not exist|could not find the table/i.test(msg)) {
      return 'users tablosu yok. Supabase SQL Editor’da meldus/sql/users.sql dosyasını çalıştırın.';
    }
    return msg || 'Veritabanı hatası.';
  }

  function hashPassword(plain) {
    var data = new TextEncoder().encode('meldus-user:' + String(plain || ''));
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return (b < 16 ? '0' : '') + b.toString(16);
      }).join('');
    });
  }

  function looksHashed(value) {
    return /^[a-f0-9]{64}$/i.test(String(value || ''));
  }

  function passwordMatches(stored, plain) {
    var s = String(stored || '');
    return hashPassword(plain).then(function (hashed) {
      if (s === hashed) return true;
      if (!looksHashed(s) && s === String(plain || '')) return true;
      return false;
    });
  }

  function loadLocalUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function loadUsers() {
    return usersCache.slice();
  }

  function refreshUsers() {
    var sb = getClient();
    if (!sb) return Promise.reject(new Error('Veritabanı bağlantısı yok.'));
    return sb.from(USERS_TABLE).select('id, username, password').order('username', { ascending: true }).then(function (res) {
      if (res.error) throw res.error;
      usersCache = (res.data || []).map(function (row) {
        return {
          id: row.id,
          username: normalizeUser(row.username),
          password: row.password
        };
      });
      return loadUsers();
    });
  }

  function migrateLocalUsers() {
    var local = loadLocalUsers();
    if (!local.length) return Promise.resolve(loadUsers());
    var sb = getClient();
    if (!sb) return Promise.resolve(loadUsers());
    var existing = {};
    usersCache.forEach(function (row) {
      existing[normalizeUser(row.username)] = true;
    });
    var pending = local.filter(function (row) {
      var u = normalizeUser(row.username);
      return u && !isMasterUser(u) && !existing[u];
    });
    if (!pending.length) {
      try { localStorage.removeItem(USERS_KEY); } catch (e) {}
      return Promise.resolve(loadUsers());
    }
    var chain = Promise.resolve();
    pending.forEach(function (row) {
      chain = chain.then(function () {
        return hashPassword(row.password).then(function (hashed) {
          return sb.from(USERS_TABLE).insert({
            username: normalizeUser(row.username),
            password: hashed
          });
        }).then(function (res) {
          if (res.error && res.error.code !== '23505') throw res.error;
        });
      });
    });
    return chain.then(function () {
      try { localStorage.removeItem(USERS_KEY); } catch (e) {}
      return refreshUsers();
    });
  }

  function getSession() {
    try {
      return normalizeUser(localStorage.getItem(SESSION_KEY) || '');
    } catch (e) {
      return '';
    }
  }

  function setSession(username) {
    if (username) localStorage.setItem(SESSION_KEY, normalizeUser(username));
    else localStorage.removeItem(SESSION_KEY);
  }

  function isMasterUser(username) {
    return normalizeUser(username) === MASTER_USER;
  }

  function isMaster() {
    return isMasterUser(getSession());
  }

  function findUser(username) {
    var key = normalizeUser(username);
    var list = loadUsers();
    for (var i = 0; i < list.length; i++) {
      if (normalizeUser(list[i].username) === key) return list[i];
    }
    return null;
  }

  function validateCredentials(username, password) {
    var u = normalizeUser(username);
    var p = String(password || '');
    if (!u || !p) return Promise.resolve({ ok: false, reason: 'empty' });
    if (isMasterUser(u) && p === MASTER_PASS) {
      return Promise.resolve({ ok: true, username: MASTER_USER, master: true });
    }
    return refreshUsers().then(function () {
      var row = findUser(u);
      if (!row) return { ok: false, reason: 'invalid' };
      return passwordMatches(row.password, p).then(function (ok) {
        if (!ok) return { ok: false, reason: 'invalid' };
        return { ok: true, username: normalizeUser(row.username), master: false };
      });
    });
  }

  function deleteUser(username) {
    var key = normalizeUser(username);
    if (isMasterUser(key)) return Promise.resolve(false);
    var sb = getClient();
    if (!sb) return Promise.reject(new Error('Veritabanı bağlantısı yok.'));
    return sb.from(USERS_TABLE).delete().eq('username', key).then(function (res) {
      if (res.error) throw res.error;
      return refreshUsers().then(function () { return true; });
    });
  }

  function resetUserPassword(username, newPassword) {
    return updateUser(username, { password: newPassword }).then(function (result) {
      return !!(result && result.ok);
    });
  }

  function updateUser(oldUsername, fields) {
    var key = normalizeUser(oldUsername);
    if (isMasterUser(key)) return Promise.resolve({ ok: false, reason: 'master' });
    fields = fields || {};
    var row = findUser(key);
    if (!row) return Promise.resolve({ ok: false, reason: 'missing' });

    var nextUser = row.username;
    var nextPass = null;

    if (fields.username != null) {
      var nu = normalizeUser(fields.username);
      if (!nu || nu.length < 2) return Promise.resolve({ ok: false, reason: 'user-short' });
      if (!/^[a-z0-9._-]+$/i.test(nu)) return Promise.resolve({ ok: false, reason: 'user-chars' });
      if (isMasterUser(nu)) return Promise.resolve({ ok: false, reason: 'reserved' });
      if (nu !== key && findUser(nu)) return Promise.resolve({ ok: false, reason: 'taken' });
      nextUser = nu;
    }
    if (fields.password != null) {
      var np = String(fields.password);
      if (!np || np.length < 4) return Promise.resolve({ ok: false, reason: 'pass-short' });
      nextPass = np;
    }

    var sb = getClient();
    if (!sb) return Promise.reject(new Error('Veritabanı bağlantısı yok.'));

    var hashStep = nextPass != null ? hashPassword(nextPass) : Promise.resolve(null);
    return hashStep.then(function (hashed) {
      var patch = { username: nextUser };
      if (hashed) patch.password = hashed;
      return sb.from(USERS_TABLE).update(patch).eq('username', key);
    }).then(function (res) {
      if (res.error) {
        if (res.error.code === '23505') return { ok: false, reason: 'taken' };
        throw res.error;
      }
      return refreshUsers().then(function () {
        if (getSession() === key && nextUser !== key) setSession(nextUser);
        return { ok: true, username: nextUser };
      });
    });
  }

  function hasValidSession() {
    var sessionUser = getSession();
    if (!sessionUser) return false;
    if (isMasterUser(sessionUser)) return true;
    return !!findUser(sessionUser);
  }

  var gate = document.getElementById('meldus-auth-gate');
  var panelLogin = document.getElementById('meldus-auth-login');
  var panelRegister = document.getElementById('meldus-auth-register');
  var loginUser = document.getElementById('meldus-login-user');
  var loginPass = document.getElementById('meldus-login-pass');
  var loginErr = document.getElementById('meldus-login-error');
  var regUser = document.getElementById('meldus-reg-user');
  var regPass = document.getElementById('meldus-reg-pass');
  var regPass2 = document.getElementById('meldus-reg-pass2');
  var regCode = document.getElementById('meldus-reg-code');
  var regErr = document.getElementById('meldus-reg-error');
  var userLabel = document.getElementById('meldus-auth-user');
  var btnLogout = document.getElementById('btn-meldus-logout');
  var btnSonIslemler = document.getElementById('btn-son-islemler');

  function showError(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function showLogin() {
    if (panelLogin) panelLogin.hidden = false;
    if (panelRegister) panelRegister.hidden = true;
    showError(loginErr, '');
    if (loginUser) loginUser.focus();
  }

  function showRegister() {
    if (panelLogin) panelLogin.hidden = true;
    if (panelRegister) panelRegister.hidden = false;
    showError(regErr, '');
    if (regUser) regUser.focus();
  }

  function updateMasterUi(username) {
    if (btnSonIslemler) btnSonIslemler.hidden = !isMasterUser(username);
  }

  function unlockApp(username) {
    document.body.classList.remove('meldus-locked');
    if (gate) {
      gate.hidden = true;
      gate.setAttribute('aria-hidden', 'true');
    }
    if (userLabel) userLabel.textContent = username || '';
    if (btnLogout) btnLogout.hidden = false;
    updateMasterUi(username);
    if (started) return;
    started = true;
    readyCallbacks.forEach(function (cb) {
      try { cb(username); } catch (e) {}
    });
    readyCallbacks = [];
  }

  function lockApp() {
    document.body.classList.add('meldus-locked');
    if (gate) {
      gate.hidden = false;
      gate.setAttribute('aria-hidden', 'false');
    }
    if (userLabel) userLabel.textContent = '';
    if (btnLogout) btnLogout.hidden = true;
    updateMasterUi('');
    showLogin();
  }

  function tryLogin() {
    var u = normalizeUser(loginUser && loginUser.value);
    var p = String(loginPass && loginPass.value || '');
    validateCredentials(u, p).then(function (result) {
      if (!result.ok) {
        showError(loginErr, result.reason === 'empty'
          ? 'Kullanıcı adı ve şifre giriniz.'
          : 'Kullanıcı adı veya şifre hatalı.');
        return;
      }
      setSession(result.username);
      if (loginPass) loginPass.value = '';
      unlockApp(result.username);
    }).catch(function (err) {
      showError(loginErr, dbErrorMessage(err));
    });
  }

  function tryRegister() {
    var u = normalizeUser(regUser && regUser.value);
    var p = String(regPass && regPass.value || '');
    var p2 = String(regPass2 && regPass2.value || '');
    var code = String(regCode && regCode.value || '').trim();
    if (!u || u.length < 2) {
      showError(regErr, 'Kullanıcı adı en az 2 karakter olmalı.');
      return;
    }
    if (!/^[a-z0-9._-]+$/i.test(u)) {
      showError(regErr, 'Kullanıcı adında sadece harf, rakam, . _ - kullanın.');
      return;
    }
    if (isMasterUser(u)) {
      showError(regErr, 'Bu kullanıcı adı kullanılamaz.');
      return;
    }
    if (!p || p.length < 4) {
      showError(regErr, 'Şifre en az 4 karakter olmalı.');
      return;
    }
    if (p !== p2) {
      showError(regErr, 'Şifreler eşleşmiyor.');
      return;
    }
    if (code !== REGISTER_CODE) {
      showError(regErr, 'Kayıt kodu hatalı.');
      return;
    }
    var sb = getClient();
    if (!sb) {
      showError(regErr, 'Veritabanı bağlantısı yok.');
      return;
    }
    refreshUsers().then(function () {
      if (findUser(u)) {
        showError(regErr, 'Bu kullanıcı adı zaten kayıtlı.');
        return null;
      }
      return hashPassword(p).then(function (hashed) {
        return sb.from(USERS_TABLE).insert({ username: u, password: hashed });
      });
    }).then(function (res) {
      if (!res) return;
      if (res.error) {
        if (res.error.code === '23505') {
          showError(regErr, 'Bu kullanıcı adı zaten kayıtlı.');
          return;
        }
        showError(regErr, dbErrorMessage(res.error));
        return;
      }
      return refreshUsers().then(function () {
        setSession(u);
        if (regPass) regPass.value = '';
        if (regPass2) regPass2.value = '';
        if (regCode) regCode.value = '';
        unlockApp(u);
      });
    }).catch(function (err) {
      showError(regErr, dbErrorMessage(err));
    });
  }

  var usersReady = getClient()
    ? refreshUsers().then(migrateLocalUsers)
    : Promise.reject(new Error('Veritabanı bağlantısı yok.'));

  function bootGate() {
    usersReady.then(function () {
      if (hasValidSession()) unlockApp(getSession());
      else {
        setSession('');
        lockApp();
      }
    }).catch(function (err) {
      if (isMasterUser(getSession())) {
        unlockApp(getSession());
        return;
      }
      setSession('');
      lockApp();
      if (loginErr) showError(loginErr, dbErrorMessage(err));
    });
  }

  if (gate) {
    document.querySelectorAll('[data-auth-show="register"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); showRegister(); });
    });
    document.querySelectorAll('[data-auth-show="login"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); showLogin(); });
    });

    var btnLogin = document.getElementById('btn-meldus-login');
    if (btnLogin) btnLogin.addEventListener('click', tryLogin);
    var btnRegister = document.getElementById('btn-meldus-register');
    if (btnRegister) btnRegister.addEventListener('click', tryRegister);

    [loginUser, loginPass].forEach(function (el) {
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); tryLogin(); }
      });
    });
    [regUser, regPass, regPass2, regCode].forEach(function (el) {
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); tryRegister(); }
      });
    });

    if (btnLogout) {
      btnLogout.addEventListener('click', function () {
        setSession('');
        started = false;
        lockApp();
        window.location.reload();
      });
    }

    if (btnSonIslemler) {
      btnSonIslemler.hidden = true;
      btnSonIslemler.addEventListener('click', function () {
        if (!isMaster()) return;
        var w = window.open('/arif/', 'meldus_son_islemler');
        if (w) {
          try { w.focus(); } catch (e) {}
        }
      });
    }

    bootGate();
  }

  window.meldusAuth = {
    getUser: getSession,
    isMaster: isMaster,
    isMasterUser: isMasterUser,
    hasValidSession: hasValidSession,
    loadUsers: loadUsers,
    refreshUsers: refreshUsers,
    whenUsersReady: function (cb) {
      if (typeof cb !== 'function') return usersReady;
      return usersReady.then(function (list) { cb(list); return list; });
    },
    deleteUser: deleteUser,
    resetUserPassword: resetUserPassword,
    updateUser: updateUser,
    findUser: findUser,
    setSession: setSession,
    whenReady: function (cb) {
      if (typeof cb !== 'function') return;
      if (started && getSession()) cb(getSession());
      else readyCallbacks.push(cb);
    }
  };
})();
