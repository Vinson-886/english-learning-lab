/**
 * auth-sync.js — CloudBase PG 模式鉴权与云端进度同步
 *
 * 设计思路：
 *   1. 打开网站自动匿名登录 → 立刻能用
 *   2. 设置页"绑定邮箱" → 验证码升级为正式账号
 *   3. 数据库用 CloudBase SDK 的 rdb().from()，链式 API 与 Supabase 一致
 *   4. 离线时降级为纯 localStorage，不阻塞学习
 *
 * 暴露到 window.AuthSync：
 *   - init()                 应用启动时调用
 *   - signUp(email, pass)    注册（尝试 HTTP API 直接调用）
 *   - signIn(email, pass)    登录
 *   - signOut()              登出
 *   - signInAnonymous()      匿名登录
 *   - getSession()           当前 session 或 null
 *   - schedulePush(state)    防抖推送进度到云端
 *   - pullFromCloud()        强制从云端拉取
 *   - getSyncStatus()        同步状态对象
 *
 * 事件 (document.dispatchEvent)：
 *   - auth:success           登录/注册/匿名登录成功
 *   - auth:logout            登出成功
 *   - sync:pulled-newer      云端数据比本地新，已覆盖
 *   - sync:pushed            推送成功
 *   - sync:error             同步出错
 */
(function () {
  "use strict";

  // ---------- 0. 初始化 CloudBase SDK ----------
  let cloudbaseApp = null;
  let db = null;        // app.rdb()
  let auth = null;      // app.auth

  function ensureCloudBase() {
    if (cloudbaseApp) return { app: cloudbaseApp, db, auth };
    if (!window.cloudbase) {
      console.warn("[AuthSync] CloudBase SDK 未加载，同步功能禁用。");
      return null;
    }
    const cfg = window.CLOUDBASE_CONFIG || {};
    if (!cfg.envId || cfg.envId.includes("your-env-id")) {
      console.warn("[AuthSync] 请先在 cloudbase-config.js 填入 envId 和 accessKey。");
      return null;
    }
    try {
      const initOptions = {
        env: cfg.envId,
        accessKey: cfg.accessKey
      };
      // 地域：不传默认上海；广州/新加坡环境必须显式指定，否则会连不上
      if (cfg.region) initOptions.region = cfg.region;
      cloudbaseApp = window.cloudbase.init(initOptions);
      // PG 模式：app.rdb() 获取关系型数据库实例
      // auth 模块：app.auth
      if (typeof cloudbaseApp.rdb === "function") {
        db = cloudbaseApp.rdb();
      } else if (typeof cloudbaseApp.database === "function") {
        db = cloudbaseApp.database(); // 传统模式 fallback，但我们主要用 rdb 的 from()
      }
      auth = cloudbaseApp.auth();
      return { app: cloudbaseApp, db, auth };
    } catch (e) {
      console.warn("[AuthSync] CloudBase 初始化失败:", e);
      return null;
    }
  }

  // ---------- 1. Session 管理 ----------
  // CloudBase SDK 会自动持久化 session（localStorage），这里我们再加一层本地缓存
  const SESSION_META_KEY = "sap-hcm-english.sessionmeta";

  function loadSessionMeta() {
    try { return JSON.parse(localStorage.getItem(SESSION_META_KEY)) || {}; }
    catch { return {}; }
  }
  function saveSessionMeta(meta) {
    try { localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta)); } catch {}
  }

  // ---------- 2. 同步状态 ----------
  const status = {
    online: navigator.onLine,
    authed: false,
    isAnonymous: false,
    isLocalFallback: false,  // 标记：CloudBase 未配置，用本地伪匿名
    userId: null,
    lastPush: null,
    lastPull: null,
    lastServerUpdate: null,
    pushTimer: null
  };

  window.addEventListener("online",  () => { status.online = true;  document.dispatchEvent(new CustomEvent("sync:online"));  });
  window.addEventListener("offline", () => { status.online = false; document.dispatchEvent(new CustomEvent("sync:offline")); });

  // ---------- 3. 鉴权 ----------
  function getSession() {
    const cb = ensureCloudBase();
    if (!cb) return null;
    try {
      // CloudBase auth.getSession() 返回登录态
      const sess = cb.auth.getSession();
      if (sess && sess.user) {
        status.authed = true;
        status.userId = sess.user.uid || sess.user.id || sess.user.sub || null;
        status.isAnonymous = !!(sess.user && sess.user.anonymous);
        return sess;
      }
    } catch (e) {
      console.warn("[AuthSync] getSession:", e);
    }
    return null;
  }

  async function signInAnonymous() {
    const cb = ensureCloudBase();
    if (!cb) throw new Error("CloudBase 未配置");
    try {
      const state = await cb.auth.signInAnonymously();
      status.authed = true;
      status.isAnonymous = true;
      if (state && state.user) status.userId = state.user.uid || state.user.id || state.user.sub || null;
      document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: state && state.user, isAnonymous: true } }));
      return state;
    } catch (err) {
      // 有些 CloudBase 环境可能没开匿名登录 — 我们手动发一个"伪匿名" session
      // 用设备唯一标识生成本地用户，进度仍然存云端
      return createLocalAnonymous();
    }
  }

  // 设备 ID + 本地"伪匿名" fallback
  function deviceId() {
    let id = localStorage.getItem("sap-hcm-english.device-id");
    if (!id) {
      id = "anon_" + Math.random().toString(36).slice(2, 12) + "_" + Date.now().toString(36);
      localStorage.setItem("sap-hcm-english.device-id", id);
    }
    return id;
  }

  function createLocalAnonymous() {
    const uid = deviceId();
    status.authed = true;
    status.isAnonymous = true;
    status.isLocalFallback = true;
    status.userId = uid;
    const sess = {
      user: { uid, id: uid, sub: uid, anonymous: true, email: null },
      access_token: null,
      isLocalFallback: true
    };
    saveSessionMeta({ uid, anonymous: true, isLocalFallback: true });
    document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: sess.user, isAnonymous: true, isLocalFallback: true } }));
    return sess;
  }

  async function signIn(email, password) {
    const cb = ensureCloudBase();
    if (!cb) throw new Error("CloudBase 未配置");
    try {
      // CloudBase SDK v3 支持 username + password，username 可填 email
      const state = await cb.auth.signInWithPassword({ username: email, password });
      status.authed = true;
      status.isAnonymous = false;
      if (state && state.user) status.userId = state.user.uid || state.user.id || state.user.sub || null;
      document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: state && state.user, isAnonymous: false } }));
      return state;
    } catch (err) {
      // 如果 SDK 方法不可用，fallback 到 HTTP REST API
      return signInViaRest(email, password);
    }
  }

  async function signInViaRest(email, password) {
    const cfg = window.CLOUDBASE_CONFIG || {};
    const base = `https://${cfg.envId}.api.tcloudbasegateway.com`;
    // CloudBase /auth/v1/token?grant_type=password
    const resp = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-id": deviceId() },
      body: JSON.stringify({ username: email, password })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error_description || data.message || "登录失败，请检查邮箱密码");
    }
    // 手动存入 CloudBase SDK 的 token 存储
    const cb = ensureCloudBase();
    if (cb && cb.auth && typeof cb.auth.setToken === "function") {
      cb.auth.setToken({ accessToken: data.access_token, refreshToken: data.refresh_token });
    }
    status.authed = true;
    status.isAnonymous = false;
    status.userId = data.sub || null;
    document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: { uid: data.sub, email } } }));
    return data;
  }

  async function signUp(email, password) {
    const cb = ensureCloudBase();
    if (!cb) throw new Error("CloudBase 未配置");
    const cfg = window.CLOUDBASE_CONFIG || {};

    // 先尝试 HTTP REST API 直接注册（不传 verification_token）
    // 如果 CloudBase 强制要求验证码，会返回错误
    const base = `https://${cfg.envId}.api.tcloudbasegateway.com`;
    const resp = await fetch(`${base}/auth/v1/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-id": deviceId() },
      body: JSON.stringify({ email, password, username: email })
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.access_token) {
      // 注册成功且直接登录了
      status.authed = true;
      status.isAnonymous = false;
      status.userId = data.sub || null;
      document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: { uid: data.sub, email }, isNew: true } }));
      return data;
    }

    // 如果需要验证码 — 返回特殊错误让 UI 提示
    const msg = (data.error_description || data.message || "").toLowerCase();
    if (resp.status === 400 && (msg.includes("verification") || msg.includes("code") || msg.includes("captcha"))) {
      throw new Error("CloudBase 要求验证码注册。请在 CloudBase 控制台 Authentication 中关闭验证码，或使用手机号/邮箱验证码注册。");
    }

    throw new Error(data.error_description || data.message || "注册失败，请稍后重试");
  }

  async function signOut() {
    const cb = ensureCloudBase();
    if (cb && cb.auth) {
      try { await cb.auth.signOut(); } catch (e) { /* ignore */ }
    }
    status.authed = false;
    status.isAnonymous = false;
    status.isLocalFallback = false;
    status.userId = null;
    saveSessionMeta({});
    document.dispatchEvent(new CustomEvent("auth:logout"));
  }

  // ---------- 4. 云端读写 ----------
  async function pushToCloud(state) {
    const cb = ensureCloudBase();
    if (!cb || !cb.db || !status.authed || !status.online || !status.userId) return false;
    try {
      const payload = JSON.stringify(state);
      const table = cb.db.from ? cb.db : cb.db.collection ? cb.db : null;
      if (!table) {
        console.warn("[AuthSync] db.from 不可用，跳过推送");
        return false;
      }
      // upsert：CloudBase PG 的 .upsert() API 和 Supabase 一致
      // 主键是 user_id，冲突时更新
      const result = await table("user_progress")
        .upsert({
          user_id: status.userId,
          progress_json: payload,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
      if (result && result.error) throw result.error;

      status.lastPush = new Date();
      const meta = loadSessionMeta();
      meta.lastServerUpdate = status.lastPush.toISOString();
      saveSessionMeta(meta);
      document.dispatchEvent(new CustomEvent("sync:pushed"));
      return true;
    } catch (err) {
      console.warn("[AuthSync] 推送失败:", err.message || err);
      document.dispatchEvent(new CustomEvent("sync:error", { detail: { message: err.message || "推送失败" } }));
      return false;
    }
  }

  async function pullFromCloud() {
    const cb = ensureCloudBase();
    if (!cb || !cb.db || !status.authed || !status.online || !status.userId) return null;
    try {
      const result = await cb.db.from("user_progress")
        .select("progress_json, updated_at")
        .eq("user_id", status.userId)
        .limit(1)
        .maybeSingle();

      if (result && result.error) throw result.error;
      if (!result || !result.data) return null;

      status.lastPull = new Date();
      const data = result.data;
      const meta = loadSessionMeta();
      meta.lastServerUpdate = new Date(data.updated_at).toISOString();
      saveSessionMeta(meta);
      return data;
    } catch (err) {
      console.warn("[AuthSync] 拉取失败:", err.message || err);
      document.dispatchEvent(new CustomEvent("sync:error", { detail: { message: err.message || "拉取失败" } }));
      return null;
    }
  }

  // ---------- 5. 防抖推送 ----------
  let latestStateRef = null;
  function schedulePush(stateGetter) {
    latestStateRef = typeof stateGetter === "function" ? stateGetter : () => stateGetter;
    if (status.pushTimer) clearTimeout(status.pushTimer);
    status.pushTimer = setTimeout(() => {
      status.pushTimer = null;
      if (!status.authed || !status.online || !status.userId) return;
      const s = latestStateRef && latestStateRef();
      if (!s) return;
      pushToCloud(s);
    }, 1500);
  }

  // ---------- 6. 冲突解决 ----------
  function mergeWithCloud(localState, cloudData) {
    if (!cloudData || !cloudData.progress_json) return { mergedState: localState, usedCloud: false };
    let cloudState;
    try {
      cloudState = typeof cloudData.progress_json === "string"
        ? JSON.parse(cloudData.progress_json)
        : cloudData.progress_json;
    } catch { return { mergedState: localState, usedCloud: false }; }

    const localAt  = new Date((localState && localState._updatedAt) || 0);
    const serverAt = new Date(cloudData.updated_at || 0);

    if (serverAt.getTime() > localAt.getTime()) {
      if (cloudState.settings && localState && localState.settings) {
        cloudState.settings = { ...localState.settings, ...cloudState.settings };
      }
      return { mergedState: cloudState, usedCloud: true };
    }
    return { mergedState: localState || cloudState, usedCloud: false };
  }

  // ---------- 7. 初始化 ----------
  async function init() {
    // 先尝试恢复已有登录态
    const sess = getSession();
    if (sess && sess.user) {
      status.authed = true;
      document.dispatchEvent(new CustomEvent("auth:success", { detail: { user: sess.user, restored: true } }));
      // 后台拉一次云端
      setTimeout(async () => {
        try {
          const cloudData = await pullFromCloud();
          if (cloudData) {
            const localRaw = localStorage.getItem("sap-hcm-english.v1.1");
            let localState = null;
            try { localState = localRaw ? JSON.parse(localRaw) : null; } catch {}
            const { mergedState, usedCloud } = mergeWithCloud(localState || {}, cloudData);
            if (usedCloud && mergedState) {
              mergedState._updatedAt = new Date().toISOString();
              localStorage.setItem("sap-hcm-english.v1.1", JSON.stringify(mergedState));
              document.dispatchEvent(new CustomEvent("sync:pulled-newer", { detail: { state: mergedState } }));
            }
          }
        } catch (e) { console.warn(e); }
      }, 200);
      return sess;
    }

    // 没有登录态 — 尝试匿名登录
    try {
      const anon = await signInAnonymous();
      return anon;
    } catch (e) {
      console.warn("[AuthSync] 匿名登录也失败，使用本地 fallback:", e.message);
      return createLocalAnonymous();
    }
  }

  function getSyncStatus() {
    return {
      online: status.online,
      authed: status.authed,
      isAnonymous: status.isAnonymous,
      isLocalFallback: status.isLocalFallback,
      userId: status.userId,
      lastPush: status.lastPush,
      lastPull: status.lastPull,
      lastServerUpdate: status.lastServerUpdate
    };
  }

  // ---------- 8. 暴露 API ----------
  window.AuthSync = {
    init, signUp, signIn, signOut, signInAnonymous,
    getSession, schedulePush, pullFromCloud, getSyncStatus
  };
})();
