(function () {
  var cfg = window.STAFF_APP_CONFIG || {};
  var state = {
    apiBase: localStorage.getItem('staff_api_base') || cfg.apiBase || '',
    token: localStorage.getItem('staffToken') || '',
    filter: '',
    sessions: [],
    currentSessionId: 0,
    currentTitle: '',
    messages: [],
    ws: null,
    wsTimer: null,
    pollTimer: null
  };

  var els = {
    login: document.getElementById('view-login'),
    list: document.getElementById('view-list'),
    chat: document.getElementById('view-chat'),
    apiBaseInput: document.getElementById('apiBaseInput'),
    passwordInput: document.getElementById('passwordInput'),
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    sessionList: document.getElementById('sessionList'),
    messageList: document.getElementById('messageList'),
    chatTitle: document.getElementById('chatTitle'),
    replyInput: document.getElementById('replyInput'),
    sendBtn: document.getElementById('sendBtn'),
    backBtn: document.getElementById('backBtn'),
    wsStatus: document.getElementById('wsStatus'),
    wsStatusChat: document.getElementById('wsStatusChat')
  };

  function apiUrl(path) {
    var base = state.apiBase || '';
    if (base.slice(-1) !== '/') base += '/';
    return base + path.replace(/^\//, '');
  }

  function wsUrl() {
    var base = state.apiBase || '';
    var u = base.replace(/^http/i, 'ws').replace(/\/$/, '');
    return u + (cfg.wsPath || '/ws/serviceChat') +
      '?token=' + encodeURIComponent(state.token) +
      '&role=staff';
  }

  function request(path, options) {
    options = options || {};
    return fetch(apiUrl(path), {
      method: options.method || 'POST',
      headers: Object.assign({
        token: state.token,
        'Content-Type': options.json ? 'application/json' : 'application/x-www-form-urlencoded'
      }, options.headers || {}),
      body: options.body
    }).then(function (res) { return res.json(); }).then(function (json) {
      if (json.code === 200) return json.data;
      throw new Error((json.data || json.msg) || '请求失败');
    });
  }

  function postForm(path, data) {
    var body = new URLSearchParams();
    Object.keys(data).forEach(function (k) {
      if (data[k] != null && data[k] !== '') body.append(k, data[k]);
    });
    return request(path, { body: body.toString() });
  }

  function showView(name) {
    ['login', 'list', 'chat'].forEach(function (v) {
      els[v].classList.toggle('hidden', v !== name);
    });
  }

  function setWsOnline(online) {
    [els.wsStatus, els.wsStatusChat].forEach(function (el) {
      if (!el) return;
      el.classList.toggle('online', online);
      el.classList.toggle('offline', !online);
    });
  }

  function notify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body: body, icon: 'icon-192.png' });
    }
  }

  function requestNotifyPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function connectWs() {
    disconnectWs();
    if (!state.token) return;
    try {
      state.ws = new WebSocket(wsUrl());
    } catch (e) {
      setWsOnline(false);
      return;
    }
    state.ws.onopen = function () {
      setWsOnline(true);
      pingLoop();
    };
    state.ws.onclose = function () {
      setWsOnline(false);
      clearInterval(state.wsTimer);
      setTimeout(connectWs, 3000);
    };
    state.ws.onerror = function () { setWsOnline(false); };
    state.ws.onmessage = function (ev) {
      try {
        var data = JSON.parse(ev.data);
        onWsEvent(data);
      } catch (e) {}
    };
  }

  function pingLoop() {
    clearInterval(state.wsTimer);
    state.wsTimer = setInterval(function () {
      if (state.ws && state.ws.readyState === 1) {
        state.ws.send('ping');
      }
    }, 25000);
  }

  function disconnectWs() {
    clearInterval(state.wsTimer);
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }
  }

  function onWsEvent(data) {
    if (!data || !data.type) return;
    if (data.type === 'message') {
      var sid = data.sessionId;
      var preview = (data.message && data.message.text) || '[消息]';
      if (state.currentSessionId === sid) {
        appendMessage(data.message);
      }
      updateSessionPreview(sid, preview);
      if (data.message && data.message.role === 'user') {
        notify('新用户消息', preview);
        vibrate();
      }
      if (!els.list.classList.contains('hidden')) {
        loadSessions(true);
      }
    }
    if (data.type === 'sessionUpdate') {
      loadSessions(true);
    }
  }

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }

  function updateSessionPreview(sessionId, preview) {
    state.sessions = state.sessions.map(function (s) {
      if (s.id === sessionId) {
        s.lastPreview = preview;
      }
      return s;
    });
    renderSessions();
  }

  function roleLabel(role) {
    if (role === 'user') return '用户';
    if (role === 'staff') return '客服';
    return '系统';
  }

  function renderSessions() {
    if (!state.sessions.length) {
      els.sessionList.innerHTML = '<p style="text-align:center;color:#999;padding:40px 0;">暂无会话</p>';
      return;
    }
    els.sessionList.innerHTML = state.sessions.map(function (s) {
      var badge = s.humanPending == 1 ? '<span class="session-item__badge">待人工</span>' : '';
      return '<article class="session-item" data-id="' + s.id + '" data-title="' + escapeHtml(s.userNickname || ('用户' + s.userId)) + '">' +
        '<div class="session-item__head"><span class="session-item__name">' + escapeHtml(s.userNickname || ('用户' + s.userId)) + '</span>' + badge + '</div>' +
        '<div class="session-item__preview">' + escapeHtml(s.lastPreview || '暂无消息') + '</div>' +
        '<span class="session-item__time">' + escapeHtml(s.updateTime || '') + '</span></article>';
    }).join('');
    Array.prototype.forEach.call(els.sessionList.querySelectorAll('.session-item'), function (node) {
      node.onclick = function () {
        openChat(Number(node.dataset.id), node.dataset.title);
      };
    });
  }

  function renderMessages() {
    els.messageList.innerHTML = state.messages.map(function (m) {
      var links = '';
      if (m.links && m.links.length) {
        links = '<div class="msg__bubble">' + m.links.map(function (l) { return escapeHtml(l); }).join('<br>') + '</div>';
      }
      var bubble = m.text ? '<div class="msg__bubble">' + escapeHtml(m.text) + '</div>' : '';
      return '<div class="msg msg--' + (m.role || 'bot') + '">' +
        '<div class="msg__meta">' + roleLabel(m.role) + ' ' + escapeHtml(m.time || '') + '</div>' +
        bubble + links + '</div>';
    }).join('');
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }

  function appendMessage(msg) {
    var exists = state.messages.some(function (m) { return m.id === msg.id; });
    if (exists) return;
    state.messages.push(msg);
    renderMessages();
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function loadSessions(silent) {
    var payload = { pageNum: 1, pageSize: 50 };
    if (state.filter !== '') payload.humanPending = state.filter;
    return postForm('admin/getServiceChatPage', payload).then(function (data) {
      state.sessions = (data && data.records) || [];
      renderSessions();
    }).catch(function (err) {
      if (!silent) alert(err.message || '加载失败');
    });
  }

  function loadMessages() {
    return postForm('admin/getServiceChatMessages', { sessionId: state.currentSessionId }).then(function (list) {
      state.messages = list || [];
      renderMessages();
    });
  }

  function openChat(id, title) {
    state.currentSessionId = id;
    state.currentTitle = title || ('会话#' + id);
    els.chatTitle.textContent = state.currentTitle;
    showView('chat');
    loadMessages();
  }

  function sendReply() {
    var text = (els.replyInput.value || '').trim();
    if (!text || !state.currentSessionId) return;
    els.replyInput.value = '';
    fetch(apiUrl('admin/replyServiceChat'), {
      method: 'POST',
      headers: { token: state.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.currentSessionId, content: text })
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (json.code !== 200) throw new Error(json.data || json.msg || '发送失败');
      return loadMessages();
    }).catch(function (err) {
      alert(err.message || '发送失败');
    });
  }

  function login() {
    state.apiBase = (els.apiBaseInput.value || '').trim();
    var password = (els.passwordInput.value || '').trim();
    if (!state.apiBase) {
      alert('请填写服务器地址');
      return;
    }
    localStorage.setItem('staff_api_base', state.apiBase);
    fetch(apiUrl('admin/staffAppLogin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (json.code !== 200) throw new Error(json.data || json.msg || '登录失败');
      state.token = json.data;
      localStorage.setItem('staffToken', state.token);
      requestNotifyPermission();
      enterList();
    }).catch(function (err) {
      alert(err.message || '登录失败');
    });
  }

  function enterList() {
    showView('list');
    loadSessions();
    connectWs();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () { loadSessions(true); }, 15000);
  }

  function logout() {
    disconnectWs();
    clearInterval(state.pollTimer);
    state.token = '';
    localStorage.removeItem('staffToken');
    showView('login');
  }

  els.apiBaseInput.value = state.apiBase;
  els.loginBtn.onclick = login;
  els.logoutBtn.onclick = logout;
  var iosGuide = document.getElementById('iosGuide');
  var iosInstallBtn = document.getElementById('iosInstallBtn');
  var closeGuideBtn = document.getElementById('closeGuideBtn');
  if (iosInstallBtn && iosGuide) {
    iosInstallBtn.onclick = function () {
      window.location.href = './install/';
    };
  }
  if (closeGuideBtn && iosGuide) {
    closeGuideBtn.onclick = function () { iosGuide.classList.add('hidden'); };
    iosGuide.onclick = function (e) {
      if (e.target === iosGuide) iosGuide.classList.add('hidden');
    };
  }
  els.backBtn.onclick = function () {
    state.currentSessionId = 0;
    showView('list');
    loadSessions(true);
  };
  els.sendBtn.onclick = sendReply;
  els.replyInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendReply();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      state.filter = tab.dataset.filter || '';
      loadSessions();
    };
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.token) {
      connectWs();
      loadSessions(true);
      if (state.currentSessionId) loadMessages();
    }
  });

  if (state.token && state.apiBase) {
    enterList();
  } else {
    showView('login');
  }
})();
