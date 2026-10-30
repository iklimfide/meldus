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
  var readyCallbacks = [];
  var started = false;

  function normalizeUser(name) {
    return String(name || '').trim().toLowerCase();
  }

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers(list) {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
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
    if (!u || !p) return { ok: false, reason: 'empty' };
    if (isMasterUser(u) && p === MASTER_PASS) return { ok: true, username: MASTER_USER, master: true };
    var row = findUser(u);
    if (row && String(row.password) === p) return { ok: true, username: normalizeUser(row.username), master: false };
    return { ok: false, reason: 'invalid' };
  }

  function deleteUser(username) {
    var key = normalizeUser(username);
    if (isMasterUser(key)) return false;
    var next = loadUsers().filter(function (row) {
      return normalizeUser(row.username) !== key;
    });
    saveUsers(next);
    return true;
  }

  function resetUserPassword(username, newPassword) {
    return updateUser(username, { password: newPassword }).ok;
  }

  function updateUser(oldUsername, fields) {
    var key = normalizeUser(oldUsername);
    if (isMasterUser(key)) return { ok: false, reason: 'master' };
    fields = fields || {};
    var list = loadUsers();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (normalizeUser(list[i].username) === key) { idx = i; break; }
    }
    if (idx < 0) return { ok: false, reason: 'missing' };

    var nextUser = list[idx].username;
    var nextPass = list[idx].password;

    if (fields.username != null) {
      var nu = normalizeUser(fields.username);
      if (!nu || nu.length < 2) return { ok: false, reason: 'user-short' };
      if (!/^[a-z0-9._-]+$/i.test(nu)) return { ok: false, reason: 'user-chars' };
      if (isMasterUser(nu)) return { ok: false, reason: 'reserved' };
      if (nu !== key && findUser(nu)) return { ok: false, reason: 'taken' };
      nextUser = nu;
    }
    if (fields.password != null) {
      var np = String(fields.password);
      if (!np || np.length < 4) return { ok: false, reason: 'pass-short' };
      nextPass = np;
    }

    list[idx] = { username: nextUser, password: nextPass };
    saveUsers(list);
    if (getSession() === key && nextUser !== key) setSession(nextUser);
    return { ok: true, username: nextUser };
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
    var result = validateCredentials(u, p);
    if (!result.ok) {
      showError(loginErr, result.reason === 'empty'
        ? 'Kullanıcı adı ve şifre giriniz.'
        : 'Kullanıcı adı veya şifre hatalı.');
      return;
    }
    setSession(result.username);
    if (loginPass) loginPass.value = '';
    unlockApp(result.username);
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
    if (findUser(u)) {
      showError(regErr, 'Bu kullanıcı adı zaten kayıtlı.');
      return;
    }
    var list = loadUsers();
    list.push({ username: u, password: p });
    saveUsers(list);
    setSession(u);
    if (regPass) regPass.value = '';
    if (regPass2) regPass2.value = '';
    if (regCode) regCode.value = '';
    unlockApp(u);
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

    if (hasValidSession()) {
      unlockApp(getSession());
    } else {
      setSession('');
      lockApp();
    }
  }

  window.meldusAuth = {
    getUser: getSession,
    isMaster: isMaster,
    isMasterUser: isMasterUser,
    hasValidSession: hasValidSession,
    loadUsers: loadUsers,
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
