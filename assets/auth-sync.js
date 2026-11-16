/**
 * auth-sync.js — GitHub Gist 免费同步
 * ------------------------------------------------------------
 * 原理：把学习进度存进你自己的一个私有 Gist，
 *       电脑和手机连同一个 Gist 即可同步。
 *
 * 特点：
 *   - 完全免费，无期限、无超额收费
 *   - 不需要服务器、不需要数据库
 *   - Token 与 gistId 只存在本机 localStorage，不进公开仓库
 *   - 离线时自动降级为纯本地模式，不影响学习
 *
 * 暴露到 window.AuthSync：
 *   connect(token)       连接（验证 Token → 找/建 Gist → 拉取）
 *   disconnect()         断开连接（云端数据保留）
 *   init()               启动时恢复连接
 *   getSession()         当前连接信息
 *   getSyncStatus()      同步状态
 *   schedulePush(getter) 防抖上传
 *   pullFromCloud()      强制从云端拉取
 *   getGistUrl()         云端 Gist 地址
 *
 * 事件：
 *   auth:success / auth:logout
 *   sync:pulled-newer / sync:pushed / sync:error
 */
(function () {
  "use strict";

  const API_BASE = "https://api.github.com";
  const META_KEY = "sap-hcm-english.github";
  const FILE_NAME = "sap-hcm-english-progress.json";
  const GIST_DESC = "SAP HCM English Lab · 学习进度（自动同步）";
  const PUSH_DELAY = 2000;

  const status = {
    online: navigator.onLine,
    authed: false,
    login: null,
    gistId: null,
    lastPush: null,
    lastPull: null,
    lastError: null,
    pushTimer: null
  };

  /* ---------- 本地元数据 ---------- */
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveMeta(patch) {
    const next = Object.assign(loadMeta(), patch);
    try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch (e) {}
    return next;
  }
  function clearMeta() {
    try { localStorage.removeItem(META_KEY); } catch (e) {}
  }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  window.addEventListener("online", function () {
    status.online = true;
    emit("sync:online");
  });
  window.addEventListener("offline", function () {
    status.online = false;
    emit("sync:offline");
  });

  /* ---------- GitHub API ---------- */
  async function gh(path, options) {
    const meta = loadMeta();
    if (!meta.token) throw new Error("尚未连接 GitHub");

    const opts = options || {};
    const headers = {
      Authorization: "Bearer " + meta.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (opts.body) headers["Content-Type"] = "application/json";

    const res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    if (res.status === 401) throw new Error("Token 无效或已过期，请重新生成");
    if (res.status === 403) throw new Error("GitHub 拒绝了请求，可能是额度用尽或 Token 缺少 gist 权限");
    if (!res.ok) {
      let msg = "GitHub API 错误 " + res.status;
      try {
        const j = await res.json();
        if (j && j.message) msg = j.message;
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  /* ---------- 连接 ---------- */
  async function connect(rawToken) {
    const token = String(rawToken || "").trim();
    if (!token) throw new Error("请粘贴 Token");
    if (token.length < 20) throw new Error("Token 看起来不完整，请重新复制");

    // 先临时存起来，后面的请求要用
    saveMeta({ token: token });

    let user;
    try {
      user = await gh("/user");
    } catch (err) {
      clearMeta();
      throw err;
    }

    // 找已有的进度 Gist
    let gistId = null;
    try {
      const list = await gh("/gists?per_page=100");
      if (Array.isArray(list)) {
        const found = list.filter(function (g) {
          return g && g.files && Object.prototype.hasOwnProperty.call(g.files, FILE_NAME);
        })[0];
        if (found) gistId = found.id;
      }
    } catch (e) {
      // 列表失败不影响，继续尝试创建
    }

    // 没有就新建一个私有 Gist
    if (!gistId) {
      const body = {
        description: GIST_DESC,
        public: false,
        files: {}
      };
      body.files[FILE_NAME] = {
        content: JSON.stringify({ app: "sap-hcm-english", savedAt: new Date().toISOString(), state: null }, null, 2)
      };
      const created = await gh("/gists", { method: "POST", body: body });
      gistId = created.id;
    }

    saveMeta({ token: token, gistId: gistId, login: user.login });

    status.authed = true;
    status.login = user.login;
    status.gistId = gistId;
    status.lastError = null;

    emit("auth:success", { user: { login: user.login }, gistId: gistId });

    // 连接后立刻对齐一次云端数据
    setTimeout(function () { syncDown(true); }, 80);

    return { login: user.login, gistId: gistId };
  }

  function disconnect() {
    clearMeta();
    status.authed = false;
    status.login = null;
    status.gistId = null;
    if (status.pushTimer) {
      clearTimeout(status.pushTimer);
      status.pushTimer = null;
    }
    emit("auth:logout");
  }

  function getSession() {
    const meta = loadMeta();
    if (!meta.token || !meta.gistId) return null;
    return { user: { login: meta.login || "github" }, gistId: meta.gistId };
  }

  function getGistUrl() {
    const meta = loadMeta();
    return meta.gistId ? "https://gist.github.com/" + meta.gistId : "";
  }

  /* ---------- 上传 ---------- */
  async function pushUp(state) {
    const meta = loadMeta();
    if (!meta.token || !meta.gistId || !status.online) return false;

    try {
      const content = JSON.stringify({
        app: "sap-hcm-english",
        savedAt: new Date().toISOString(),
        state: state
      }, null, 2);

      const body = { files: {} };
      body.files[FILE_NAME] = { content: content };

      await gh("/gists/" + meta.gistId, { method: "PATCH", body: body });

      status.lastPush = new Date();
      status.lastError = null;
      emit("sync:pushed");
      return true;
    } catch (err) {
      status.lastError = err.message;
      console.warn("[AuthSync] 上传失败:", err.message);
      emit("sync:error", { message: err.message });
      return false;
    }
  }

  let latestStateGetter = null;
  function schedulePush(stateGetter) {
    latestStateGetter = typeof stateGetter === "function" ? stateGetter : function () { return stateGetter; };
    if (status.pushTimer) clearTimeout(status.pushTimer);
    status.pushTimer = setTimeout(function () {
      status.pushTimer = null;
      if (!status.authed || !status.online) return;
      const s = latestStateGetter && latestStateGetter();
      if (s) pushUp(s);
    }, PUSH_DELAY);
  }

  /* ---------- 下载 ---------- */
  async function pullFromCloud() {
    const meta = loadMeta();
    if (!meta.token || !meta.gistId || !status.online) return null;

    try {
      const gist = await gh("/gists/" + meta.gistId);
      const file = gist && gist.files ? gist.files[FILE_NAME] : null;
      if (!file) return null;

      let text = file.content;
      // 文件过大时 GitHub 会截断，需要用 raw_url 再取一次
      if (file.truncated && file.raw_url) {
        const raw = await fetch(file.raw_url);
        text = await raw.text();
      }

      let payload = null;
      try { payload = JSON.parse(text); } catch (e) { return null; }

      status.lastPull = new Date();
      return {
        payload: payload,
        state: payload && payload.state ? payload.state : null,
        updatedAt: gist.updated_at || new Date().toISOString()
      };
    } catch (err) {
      status.lastError = err.message;
      console.warn("[AuthSync] 下载失败:", err.message);
      emit("sync:error", { message: err.message });
      return null;
    }
  }

  /* ---------- 云端优先合并 ---------- */
  async function syncDown(notify) {
    const cloud = await pullFromCloud();
    if (!cloud || !cloud.state) return false;

    const localRaw = localStorage.getItem("sap-hcm-english.v1.1");
    let localState = null;
    try { localState = localRaw ? JSON.parse(localRaw) : null; } catch (e) {}

    const localAt = new Date((localState && localState._updatedAt) || 0).getTime();
    const serverAt = new Date(cloud.updatedAt || 0).getTime();

    // 云端更新 -> 覆盖本地；否则把本地推上去
    if (serverAt > localAt + 1000) {
      const incoming = cloud.state;
      incoming._updatedAt = cloud.updatedAt;
      try { localStorage.setItem("sap-hcm-english.v1.1", JSON.stringify(incoming)); } catch (e) {}
      emit("sync:pulled-newer", { state: incoming });
      if (notify) return "pulled";
      return "pulled";
    }

    if (localState) pushUp(localState);
    return "kept-local";
  }

  /* ---------- 启动恢复 ---------- */
  function init() {
    const meta = loadMeta();
    if (!meta.token || !meta.gistId) return null;

    status.authed = true;
    status.login = meta.login || "github";
    status.gistId = meta.gistId;

    setTimeout(function () { syncDown(true); }, 200);
    return getSession();
  }

  function getSyncStatus() {
    return {
      online: status.online,
      authed: status.authed,
      login: status.login,
      gistId: status.gistId,
      lastPush: status.lastPush,
      lastPull: status.lastPull,
      lastError: status.lastError
    };
  }

  window.AuthSync = {
    init: init,
    connect: connect,
    disconnect: disconnect,
    getSession: getSession,
    getSyncStatus: getSyncStatus,
    schedulePush: schedulePush,
    pullFromCloud: pullFromCloud,
    getGistUrl: getGistUrl
  };
})();
