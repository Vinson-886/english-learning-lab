(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Constants & state                                                   */
  /* ------------------------------------------------------------------ */

  const STORE_KEY = "sap-hcm-english.v1.1";
  const DAY_MS = 86400000;
  const WORD_DATA = dedupeByEnglish(window.WORDS || []);
  const PHRASE_DATA = dedupeByEnglish(window.PHRASES || []);
  const WORD_MAP = new Map(WORD_DATA.map((w) => [w.id, w]));
  const PHRASE_MAP = new Map(PHRASE_DATA.map((p) => [p.id, p]));

  function dedupeByEnglish(list) {
    const seen = new Set();
    const result = [];
    list.forEach((item) => {
      if (!item || !item.id || !item.en || !item.zh) return;
      const key = String(item.en).trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  const TYPE_META = {
    words: { data: WORD_DATA, map: WORD_MAP, quotaKey: "wordsPerDay", label: "单词", route: "words" },
    phrases: { data: PHRASE_DATA, map: PHRASE_MAP, quotaKey: "phrasesPerDay", label: "短句", route: "phrases" }
  };

  const ICON = {
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.2-4.2A8 8 0 1 1 21 12z"/><path d="M8 10h8M8 14h5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.3.4-2.5 1-3.5.3 1.2 1.1 2 2 2 0-2.5 2-4.6 2-7.5z"/><path d="M8.5 15.5a3.5 3.5 0 0 0 7 0"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'
  };

  function blankBucket() {
    return { total: 0, known: 0, unfamiliar: 0, unknown: 0, new: 0 };
  }
  function blankDay() {
    return { words: blankBucket(), phrases: blankBucket() };
  }

  function createDefaultState() {
    return {
      version: 1,
      settings: {
        wordsPerDay: 10,
        phrasesPerDay: 5,
        knownDays: 60,
        unfamiliarDays: 3,
        unknownDays: 1,
        autoSpeak: true,
        rate: 0.9,
        voice: ""
      },
      progress: { words: {}, phrases: {} },
      daily: {},
      session: {
        words: { date: "", ids: [], index: 0 },
        phrases: { date: "", ids: [], index: 0 }
      },
      streak: { last: "", count: 0 }
    };
  }

  function loadState() {
    const base = createDefaultState();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return base;
      return {
        ...base,
        ...saved,
        settings: { ...base.settings, ...(saved.settings || {}) },
        progress: {
          words: { ...(saved.progress && saved.progress.words) },
          phrases: { ...(saved.progress && saved.progress.phrases) }
        },
        daily: saved.daily && typeof saved.daily === "object" ? saved.daily : {},
        session: {
          words: { ...base.session.words, ...(saved.session && saved.session.words) },
          phrases: { ...base.session.phrases, ...(saved.session && saved.session.phrases) }
        },
        streak: { ...base.streak, ...(saved.streak || {}) }
      };
    } catch (err) {
      console.warn("读取本地学习记录失败，已使用初始数据。", err);
      return base;
    }
  }

  let state = loadState();
  let currentView = "dashboard";
  let revealedId = null;
  let lastSpokenKey = "";
  let statsRange = "today";
  let bookFilter = "all";
  let bookQuery = "";
  let libraryTab = "words";
  let libraryCategory = "全部";
  let libraryQuery = "";
  let libraryLimit = 60;
  let toastTimer = null;
  let modalAction = null;
  let voices = [];

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */

  const pad = (n) => String(n).padStart(2, "0");

  function dateKey(d) {
    const date = d || new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function monthKey(d) {
    const date = d || new Date();
    return date.getFullYear() + "-" + pad(date.getMonth() + 1);
  }

  function dayStart(ts) {
    const date = new Date(ts == null ? Date.now() : ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function dayKeyFromTs(ts) {
    return dateKey(new Date(ts));
  }

  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function weekdayCN(date) {
    return WEEKDAYS[date.getDay()];
  }

  function formatDayCN(key) {
    const parts = key.split("-");
    return Number(parts[1]) + "月" + Number(parts[2]) + "日";
  }

  function shortDate(key) {
    const parts = key.split("-");
    return Number(parts[1]) + "/" + Number(parts[2]);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function saveState() {
    try {
      state._updatedAt = new Date().toISOString();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("保存学习记录失败。", err);
    }
    // 云端推送（如果已登录）
    if (window.AuthSync && typeof window.AuthSync.schedulePush === "function") {
      window.AuthSync.schedulePush(() => state);
    }
  }

  function getDaily(key) {
    return state.daily[key] || blankDay();
  }

  function ensureDaily() {
    const key = dateKey();
    if (!state.daily[key]) state.daily[key] = blankDay();
    return state.daily[key];
  }

  function readBucket(type, key) {
    const day = state.daily[key || dateKey()];
    if (!day || !day[type]) return blankBucket();
    return day[type];
  }

  function quotaFor(type) {
    const value = Number(state.settings[TYPE_META[type].quotaKey]);
    return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 10;
  }

  function intervalFor(result) {
    if (result === "known") return Math.max(1, Math.round(Number(state.settings.knownDays) || 60));
    if (result === "unfamiliar") return Math.max(1, Math.round(Number(state.settings.unfamiliarDays) || 3));
    return Math.max(1, Math.round(Number(state.settings.unknownDays) || 1));
  }

  function statusLabel(status) {
    return status === "known" ? "认识" : status === "unfamiliar" ? "不熟悉" : "不认识";
  }

  /* ------------------------------------------------------------------ */
  /* Speech                                                              */
  /* ------------------------------------------------------------------ */

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang || ""));
    if (voices.length === 0) {
      voices = window.speechSynthesis.getVoices();
    }
  }

  function pickVoice() {
    if (!voices.length) return null;
    const saved = state.settings.voice;
    if (saved) {
      const found = voices.find((v) => v.name === saved);
      if (found) return found;
    }
    return voices.find((v) => /en[-_]US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = clamp(Number(state.settings.rate) || 0.9, 0.5, 1.5);
      const voice = pickVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.warn("朗读失败。", err);
    }
  }

  if ("speechSynthesis" in window) {
    loadVoices();
    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        loadVoices();
        if (currentView === "settings") renderCurrentView();
      });
    } else {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Progress, queue & answers                                           */
  /* ------------------------------------------------------------------ */

  function dueCount(type) {
    const now = Date.now();
    const progress = state.progress[type];
    return TYPE_META[type].data.reduce((count, item) => {
      const record = progress[item.id];
      return record && (record.nextReview || 0) <= now ? count + 1 : count;
    }, 0);
  }

  function buildQueue(type) {
    const meta = TYPE_META[type];
    const progress = state.progress[type];
    const now = Date.now();
    const due = [];
    const fresh = [];

    meta.data.forEach((item) => {
      const record = progress[item.id];
      if (!record) fresh.push(item.id);
      else if ((record.nextReview || 0) <= now) due.push(item.id);
    });

    const newToday = readBucket(type).new;
    const allowNew = Math.max(0, quotaFor(type) - newToday);
    return shuffle(due).concat(shuffle(fresh).slice(0, allowNew));
  }

  function ensureSession(type) {
    const session = state.session[type];
    const today = dateKey();
    if (session.date !== today) {
      session.date = today;
      session.ids = buildQueue(type);
      session.index = 0;
      saveState();
    }
    const map = TYPE_META[type].map;
    while (session.index < session.ids.length && !map.has(session.ids[session.index])) {
      session.index += 1;
    }
    return session;
  }

  function updateStreak() {
    const today = dateKey();
    if (state.streak.last === today) return;
    const yesterday = dayKeyFromTs(Date.now() - DAY_MS);
    state.streak.count = state.streak.last === yesterday ? (state.streak.count || 0) + 1 : 1;
    state.streak.last = today;
  }

  function applyAnswer(type, id, result) {
    const progress = state.progress[type];
    const existing = progress[id];
    const days = intervalFor(result);

    progress[id] = {
      status: result,
      nextReview: dayStart() + days * DAY_MS,
      lastReview: Date.now(),
      reviews: (existing && existing.reviews ? existing.reviews : 0) + 1
    };

    const bucket = ensureDaily()[type];
    bucket.total += 1;
    bucket[result] += 1;
    if (!existing) bucket.new += 1;

    updateStreak();
    return progress[id];
  }

  function answerCard(type, result) {
    const session = ensureSession(type);
    const id = session.ids[session.index];
    if (!id || !TYPE_META[type].map.has(id)) return;

    applyAnswer(type, id, result);
    session.index += 1;
    revealedId = null;
    saveState();

    const days = intervalFor(result);
    let message = "已标记为「" + statusLabel(result) + "」，" + (days === 1 ? "明天" : days + " 天后") + "复习";
    if (type === "words" && result !== "known") {
      message = "已加入生词本，" + (days === 1 ? "明天" : days + " 天后") + "复习";
    }
    showToast(message);
    renderCurrentView();
  }

  /* ------------------------------------------------------------------ */
  /* Charts & aggregates                                                 */
  /* ------------------------------------------------------------------ */

  function rangeKeys(range) {
    if (range === "today") return [dateKey()];
    if (range === "month") {
      const prefix = monthKey();
      return Object.keys(state.daily).filter((key) => key.indexOf(prefix) === 0);
    }
    return Object.keys(state.daily);
  }

  function aggregate(type, range) {
    const totals = { total: 0, known: 0, unfamiliar: 0, unknown: 0, new: 0 };
    rangeKeys(range).forEach((key) => {
      const bucket = state.daily[key] && state.daily[key][type];
      if (!bucket) return;
      totals.total += bucket.total || 0;
      totals.known += bucket.known || 0;
      totals.unfamiliar += bucket.unfamiliar || 0;
      totals.unknown += bucket.unknown || 0;
      totals.new += bucket.new || 0;
    });
    return totals;
  }

  function lastNDays(n) {
    const list = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const ts = dayStart() - i * DAY_MS;
      const key = dayKeyFromTs(ts);
      const day = state.daily[key] || blankDay();
      list.push({
        key: key,
        label: shortDate(key),
        weekday: weekdayCN(new Date(ts)),
        words: day.words.total,
        phrases: day.phrases.total
      });
    }
    return list;
  }

  function miniChartHTML() {
    const days = lastNDays(7);
    const max = Math.max(1, ...days.map((d) => d.words + d.phrases));
    const columns = days.map((d) => {
      const hw = d.words ? Math.max(3, Math.round((d.words / max) * 112)) : 0;
      const hp = d.phrases ? Math.max(3, Math.round((d.phrases / max) * 112)) : 0;
      return (
        '<div class="mini-col" title="' + d.key + " · 单词 " + d.words + " · 短句 " + d.phrases + '">' +
        '<div class="mini-bars"><i class="is-phrase" style="height:' + hp + 'px"></i><i style="height:' + hw + 'px"></i></div>' +
        '<span class="mini-label">' + d.label + "</span>" +
        "</div>"
      );
    });
    return columns.join("");
  }

  function trendChartHTML() {
    const days = lastNDays(14);
    const max = Math.max(1, ...days.map((d) => d.words + d.phrases));
    const columns = days.map((d, index) => {
      const hw = d.words ? Math.max(3, Math.round((d.words / max) * 162)) : 0;
      const hp = d.phrases ? Math.max(3, Math.round((d.phrases / max) * 162)) : 0;
      const isToday = index === days.length - 1;
      return (
        '<div class="chart-col" title="' + d.key + " · 单词 " + d.words + " · 短句 " + d.phrases + '">' +
        '<div class="chart-stack"><i class="p" style="height:' + hp + 'px"></i><i class="w" style="height:' + hw + 'px"></i></div>' +
        '<span class="chart-x' + (isToday ? " is-today" : "") + '">' + (isToday ? "今天" : d.label) + "</span>" +
        "</div>"
      );
    });
    return columns.join("");
  }

  /* ------------------------------------------------------------------ */
  /* Chrome (sidebar / topbar)                                           */
  /* ------------------------------------------------------------------ */

  function bookItems(filter, query) {
    const q = (query || "").trim().toLowerCase();
    return WORD_DATA.filter((word) => {
      const record = state.progress.words[word.id];
      if (!record) return false;
      if (record.status !== "unfamiliar" && record.status !== "unknown") return false;
      if (filter !== "all" && record.status !== filter) return false;
      if (q) {
        return word.en.toLowerCase().indexOf(q) !== -1 || word.zh.indexOf(q) !== -1;
      }
      return true;
    }).sort((a, b) => {
      return (state.progress.words[b.id].lastReview || 0) - (state.progress.words[a.id].lastReview || 0);
    });
  }

  function bookCounts() {
    let unfamiliar = 0;
    let unknown = 0;
    Object.keys(state.progress.words).forEach((id) => {
      const record = state.progress.words[id];
      if (record.status === "unfamiliar") unfamiliar += 1;
      if (record.status === "unknown") unknown += 1;
    });
    return { all: unfamiliar + unknown, unfamiliar: unfamiliar, unknown: unknown };
  }

  function updateChrome() {
    const now = new Date();
    const dateEl = document.getElementById("topDate");
    if (dateEl) dateEl.textContent = now.getMonth() + 1 + " 月 " + now.getDate() + " 日 · " + weekdayCN(now);

    const streakEl = document.getElementById("streakCount");
    if (streakEl) streakEl.textContent = state.streak.count || 0;

    const counts = bookCounts();
    const badge = document.getElementById("bookBadge");
    if (badge) {
      badge.textContent = counts.all > 99 ? "99+" : String(counts.all);
      badge.hidden = counts.all === 0;
    }

    const side = document.getElementById("sideGoal");
    if (side) {
      const wordToday = readBucket("words");
      const phraseToday = readBucket("phrases");
      const wordQuota = quotaFor("words");
      const phraseQuota = quotaFor("phrases");
      const wordPct = Math.min(100, Math.round((wordToday.new / wordQuota) * 100));
      const phrasePct = Math.min(100, Math.round((phraseToday.new / phraseQuota) * 100));
      side.innerHTML =
        '<h4>今日目标 <span>' + (wordToday.new >= wordQuota && phraseToday.new >= phraseQuota ? "已达成" : "进行中") + "</span></h4>" +
        '<div class="side-goal-row"><div class="side-goal-label"><span>单词</span><b>' + wordToday.new + " / " + wordQuota + '</b></div><div class="side-bar"><i style="width:' + wordPct + '%"></i></div></div>' +
        '<div class="side-goal-row"><div class="side-goal-label"><span>短句</span><b>' + phraseToday.new + " / " + phraseQuota + '</b></div><div class="side-bar"><i style="width:' + phrasePct + '%"></i></div></div>';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  function ringHTML(done, total, label, sub) {
    const ratio = total > 0 ? Math.min(1, done / total) : 0;
    const circumference = 2 * Math.PI * 52;
    const offset = circumference * (1 - ratio);
    return (
      '<div class="ring-block">' +
      '<div class="ring-wrap">' +
      '<svg class="ring" viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
      '<circle class="ring-fg" cx="60" cy="60" r="52" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"></circle></svg>' +
      '<div class="ring-center"><strong>' + done + "</strong><span>/ " + total + "</span></div>" +
      "</div>" +
      '<div class="ring-label">' + label + "<em>" + sub + "</em></div>" +
      "</div>"
    );
  }

  function renderDashboard() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
    const wordToday = readBucket("words");
    const phraseToday = readBucket("phrases");
    const wordQuota = quotaFor("words");
    const phraseQuota = quotaFor("phrases");
    const dueWords = dueCount("words");
    const duePhrases = dueCount("phrases");
    const counts = bookCounts();
    const totalWords = aggregate("words", "all");
    const totalPhrases = aggregate("phrases", "all");
    const learnedToday = wordToday.total + phraseToday.total;

    const html =
      '<div class="hero">' +
      '<div class="hero-copy">' +
      '<div class="hero-kicker">' + formatDayCN(dateKey()) + " · " + weekdayCN(now) + "</div>" +
      "<h1>" + greeting + "，今天也把 <em>SAP HCM</em> 英语练扎实</h1>" +
      "<p>3000+ 单词与 1000 条短句，覆盖 SAP HCM、职场沟通、商务与日常生活。按记忆节奏复习，把词汇真正变成你的表达。</p>" +
      '<div class="hero-actions">' +
      '<button class="btn btn-light" data-action="start-words">' + ICON.book + "开始记单词</button>" +
      '<button class="btn btn-light" data-action="start-phrases">' + ICON.chat + "短句练习</button>" +
      "</div>" +
      "</div>" +
      '<div class="hero-rings">' +
      ringHTML(wordToday.new, wordQuota, "单词", "新学 / 今日目标") +
      '<div class="hero-divider"></div>' +
      ringHTML(phraseToday.new, phraseQuota, "短句", "新学 / 今日目标") +
      "</div>" +
      "</div>" +

      '<div class="stat-grid">' +
      statCard(ICON.target, "待复习", dueWords + duePhrases, '<small>项</small>', "单词 " + dueWords + " · 短句 " + duePhrases, "") +
      statCard(ICON.book, "生词本", counts.all, '<small>个</small>', "不熟悉 " + counts.unfamiliar + " · 不认识 " + counts.unknown, "is-red") +
      statCard(ICON.flame, "连续学习", state.streak.count || 0, '<small>天</small>', learnedToday > 0 ? "今日已学习 " + learnedToday + " 项" : "完成一组即可点亮", "is-amber") +
      statCard(ICON.layers, "累计学习", totalWords.total + totalPhrases.total, '<small>次</small>', "单词 " + totalWords.total + " · 短句 " + totalPhrases.total, "is-green") +
      "</div>" +

      '<div class="dash-grid">' +
      '<div class="card">' +
      '<div class="card-head"><h3>今日学习明细</h3><span>' + formatDayCN(dateKey()) + "</span></div>" +
      todayRow("单词", "新学 " + wordToday.new + " / " + wordQuota, wordToday) +
      todayRow("短句", "新学 " + phraseToday.new + " / " + phraseQuota, phraseToday) +
      "</div>" +
      '<div class="card">' +
      '<div class="card-head"><h3>近 7 天学习轨迹</h3>' +
      '<div class="chart-legend"><span><i></i>单词</span><span><i class="teal"></i>短句</span></div></div>' +
      '<div class="mini-chart">' + miniChartHTML() + "</div>" +
      "</div>" +
      "</div>";

    document.getElementById("view-dashboard").innerHTML = html;
  }

  function statCard(icon, label, value, unit, hint, tone) {
    return (
      '<div class="card stat-card">' +
      '<div class="stat-top"><span class="stat-label">' + label + '</span><span class="stat-icon ' + (tone || "") + '">' + icon + "</span></div>" +
      '<div class="stat-value">' + value + unit + "</div>" +
      '<div class="stat-hint">' + hint + "</div>" +
      "</div>"
    );
  }

  function todayRow(label, sub, bucket) {
    return (
      '<div class="today-row">' +
      '<div class="today-type"><strong>' + label + "</strong><span>" + sub + "</span></div>" +
      '<div class="today-total">' + bucket.total + "<small>次</small></div>" +
      '<div class="today-break">' +
      "<span>认识 <b>" + bucket.known + "</b></span>" +
      "<span>不熟悉 <b>" + bucket.unfamiliar + "</b></span>" +
      "<span>不认识 <b>" + bucket.unknown + "</b></span>" +
      "</div>" +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* Study views                                                         */
  /* ------------------------------------------------------------------ */

  function renderStudy(type) {
    const meta = TYPE_META[type];
    const isWords = type === "words";
    const session = ensureSession(type);
    const today = readBucket(type);
    const quota = quotaFor(type);
    const due = dueCount(type);
    const remaining = Math.max(0, session.ids.length - session.index);
    const finished = remaining === 0;
    const totalLearned = Object.keys(state.progress[type]).length;
    const freshLeft = meta.data.length - totalLearned;
    const percent = session.ids.length ? Math.round((session.index / session.ids.length) * 100) : 0;

    let body = "";
    if (finished) {
      body = completionHTML(type, today, quota, freshLeft, due);
    } else {
      body = studyCardHTML(type, session, percent);
    }

    const html =
      '<div class="study-head">' +
      "<div><h1>" + (isWords ? "记单词" : "短句记忆") + "</h1><p>" +
      (isWords ? "SAP HCM 高频词汇 · 随机出现 · 按记忆程度自动安排复习" : "SAP 项目真实场景表达 · 随机出现 · 中英对照记忆") +
      "</p></div>" +
      '<div class="study-head-right">' +
      '<span class="chip chip-muted">今日新学 ' + today.new + " / " + quota + "</span>" +
      '<button class="btn btn-ghost btn-sm" data-nav="settings">调整计划</button>' +
      "</div>" +
      "</div>" +
      '<div class="study-layout">' +
      '<div class="study-main">' +
      '<div class="study-progress"><div class="progress-track"><div class="progress-fill" style="width:' + percent + '%"></div></div>' +
      '<span class="progress-text">' + Math.min(session.index, session.ids.length) + " / " + session.ids.length + " 本次</span></div>" +
      body +
      "</div>" +
      '<aside class="study-side">' +
      '<div class="card side-card">' +
      "<h4>今日进度</h4>" +
      sideStat("本次剩余", remaining + " 项", "is-blue") +
      sideStat("今日新学", today.new + " / " + quota, "") +
      sideStat("今日复习", Math.max(0, today.total - today.new) + " 次", "is-green") +
      sideStat("当前待复习", due + " 项", "is-amber") +
      "</div>" +
      '<div class="card side-card">' +
      "<h4>复习节奏</h4>" +
      '<div class="side-tips">' +
      "<div>认识 · " + state.settings.knownDays + " 天后</div>" +
      "<div>不熟悉 · " + state.settings.unfamiliarDays + " 天后</div>" +
      "<div>不认识 · " + (Number(state.settings.unknownDays) === 1 ? "明天" : state.settings.unknownDays + " 天后") + "</div>" +
      "</div>" +
      "</div>" +
      '<div class="card side-card">' +
      "<h4>快捷键</h4>" +
      '<div class="side-tips">' +
      "<div><kbd class=\"kbd\">空格</kbd> 显示释义</div>" +
      "<div><kbd class=\"kbd\">1</kbd> 不认识 · <kbd class=\"kbd\">2</kbd> 不熟悉 · <kbd class=\"kbd\">3</kbd> 认识</div>" +
      "<div>点击卡片可随时显示 / 隐藏中文</div>" +
      "</div>" +
      "</div>" +
      "</aside>" +
      "</div>";

    document.getElementById("view-" + type).innerHTML = html;

    if (!finished) autoSpeakCurrent(type);
  }

  function sideStat(label, value, tone) {
    return '<div class="side-stat"><span>' + label + '</span><b class="' + (tone || "") + '">' + value + "</b></div>";
  }

  function studyCardHTML(type, session, percent) {
    const meta = TYPE_META[type];
    const item = meta.map.get(session.ids[session.index]);
    const isWords = type === "words";
    const isRevealed = revealedId === item.id;

    const answerArea = isRevealed
      ? '<div class="answer-area">' +
        '<div class="word-zh">' + escapeHtml(item.zh) + "</div>" +
        (isWords
          ? '<div class="example"><div class="example-text"><div class="example-en">' + escapeHtml(item.ex) +
            '</div><div class="example-zh">' + escapeHtml(item.exZh) + "</div></div>" +
            '<button class="icon-btn" data-speak="' + escapeHtml(item.ex) + '" title="朗读例句">' + ICON.speaker + "</button></div>"
          : '<div class="example"><div class="example-text"><div class="example-zh">使用场景：' + escapeHtml(item.cat) +
            ' · 试着用这句话复述一遍，再听一次原句。</div></div>' +
            '<button class="icon-btn" data-speak="' + escapeHtml(item.en) + '" title="朗读短句">' + ICON.speaker + "</button></div>") +
        "</div>"
      : '<div class="reveal-hint">点击卡片或按空格显示释义</div>';

    return (
      '<div class="study-card" data-card="' + item.id + '">' +
      '<div class="study-card-top">' +
      '<span class="chip chip-cat">' + escapeHtml(item.cat) + "</span>" +
      '<div class="card-actions"><button class="icon-btn" data-speak="' + escapeHtml(item.en) + '" title="朗读英文">' + ICON.speaker + "</button></div>" +
      "</div>" +
      '<div class="word-body">' +
      '<div class="word-en' + (isWords ? "" : " phrase-en") + '">' + escapeHtml(item.en) + "</div>" +
      (isWords ? '<div class="word-pos">' + escapeHtml(item.pos) + " · " + escapeHtml(item.cat) + "</div>" : "") +
      answerArea +
      "</div>" +
      "</div>" +
      '<div class="answer-bar">' +
      '<button class="answer-btn" data-result="unknown" type="button">不认识<span>' + (intervalFor("unknown") === 1 ? "明天复习" : intervalFor("unknown") + " 天后复习") + ' <kbd class="kbd">1</kbd></span></button>' +
      '<button class="answer-btn" data-result="unfamiliar" type="button">不熟悉<span>' + intervalFor("unfamiliar") + " 天后复习 <kbd class=\"kbd\">2</kbd></span></button>" +
      '<button class="answer-btn" data-result="known" type="button">认识<span>' + intervalFor("known") + " 天后复习 <kbd class=\"kbd\">3</kbd></span></button>" +
      "</div>"
    );
  }

  function completionHTML(type, today, quota, freshLeft, due) {
    const isWords = type === "words";
    let title = "今日学习目标已完成";
    let desc = "新学与到期复习都处理完了，明天再按记忆节奏巩固。";
    if (freshLeft === 0 && due === 0) {
      title = isWords ? "词库已全部掌握" : "短句已全部掌握";
      desc = "所有内容都已进入复习节奏，继续保持定期回顾。";
    } else if (today.new >= quota && due === 0) {
      title = "今日新学目标已达成";
      desc = "今日新学已达到设定数量，若有到期内容会继续安排复习。";
    } else if (today.total === 0) {
      title = "暂无待学习内容";
      desc = "当前没有到期复习，也没有新的" + (isWords ? "单词" : "短句") + "可安排。";
    }

    return (
      '<div class="card complete-card">' +
      '<div class="complete-badge">' + ICON.check + "</div>" +
      "<h2>" + title + "</h2>" +
      "<p>" + desc + "</p>" +
      '<div class="complete-summary">' +
      '<div><strong>' + today.new + "</strong><span>今日新学</span></div>" +
      '<div><strong>' + today.total + "</strong><span>今日练习</span></div>" +
      '<div><strong>' + today.known + "</strong><span>认识</span></div>" +
      '<div><strong>' + today.unfamiliar + "</strong><span>不熟悉</span></div>" +
      '<div><strong>' + today.unknown + "</strong><span>不认识</span></div>" +
      "</div>" +
      '<div class="complete-actions">' +
      '<button class="btn btn-primary" data-nav="' + (isWords ? "phrases" : "words") + '">' + (isWords ? "去练短句" : "去记单词") + ICON.arrow + "</button>" +
      '<button class="btn btn-ghost" data-nav="stats">查看学习统计</button>' +
      '<button class="btn btn-ghost" data-nav="book">打开生词本</button>' +
      "</div>" +
      "</div>"
    );
  }

  function autoSpeakCurrent(type) {
    if (!state.settings.autoSpeak) return;
    const session = state.session[type];
    const id = session.ids[session.index];
    const key = type + ":" + id;
    if (!id || lastSpokenKey === key) return;
    const item = TYPE_META[type].map.get(id);
    if (!item) return;
    lastSpokenKey = key;
    window.setTimeout(() => speak(item.en), 220);
  }

  /* ------------------------------------------------------------------ */
  /* Stats                                                               */
  /* ------------------------------------------------------------------ */

  function renderStats() {
    const labels = { today: "今日", month: "本月", all: "累计" };
    const words = aggregate("words", statsRange);
    const phrases = aggregate("phrases", statsRange);
    const days = lastNDays(7);
    const hasRecent = days.some((day) => day.words + day.phrases > 0);

    const rows = days.slice().reverse().map((day) => {
      const bucket = getDaily(day.key);
      const w = bucket.words;
      const p = bucket.phrases;
      return (
        "<tr>" +
        "<td>" + shortDate(day.key) + " <span style=\"color:var(--muted-light)\">" + day.weekday + "</span></td>" +
        "<td>" + w.total + " <span style=\"color:var(--muted-light)\">(" + w.new + ")</span></td>" +
        "<td>" + p.total + " <span style=\"color:var(--muted-light)\">(" + p.new + ")</span></td>" +
        "<td><span class=\"dot g\"></span>" + (w.known + p.known) + "</td>" +
        "<td><span class=\"dot a\"></span>" + (w.unfamiliar + p.unfamiliar) + "</td>" +
        "<td><span class=\"dot r\"></span>" + (w.unknown + p.unknown) + "</td>" +
        "</tr>"
      );
    }).join("");

    const html =
      '<div class="page-head"><h1>学习统计</h1><p>记录每日与每月的单词、短句练习量，以及三种记忆程度的分布。</p></div>' +
      '<div class="stats-toolbar">' +
      '<div class="segmented">' +
      ["today", "month", "all"].map((range) =>
        '<button type="button" data-range="' + range + '" class="' + (statsRange === range ? "is-active" : "") + '">' + labels[range] + "</button>"
      ).join("") +
      "</div>" +
      '<span class="chip chip-muted">' + (statsRange === "month" ? monthKey().replace("-", " 年 ") + " 月" : labels[statsRange] + "数据") + "</span>" +
      "</div>" +
      '<div class="kpi-grid">' +
      kpiCard("单词学习", words.total, words, "book", "") +
      kpiCard("短句学习", phrases.total, phrases, "chat", "teal") +
      "</div>" +
      '<div class="card chart-card">' +
      '<div class="card-head"><h3>近 14 天学习趋势</h3>' +
      '<div class="chart-legend"><span><i></i>单词</span><span><i class="teal"></i>短句</span></div></div>' +
      '<div class="chart">' + trendChartHTML() + "</div>" +
      "</div>" +
      '<div class="card" style="margin-top:18px">' +
      '<div class="card-head"><h3>近 7 天明细</h3><span>括号内为当日新学数量</span></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>日期</th><th>单词 (新)</th><th>短句 (新)</th><th>认识</th><th>不熟悉</th><th>不认识</th>" +
      "</tr></thead><tbody>" + (hasRecent ? rows : '<tr><td colspan="6"><div class="table-empty">还没有学习记录，完成一组单词或短句后这里会自动生成统计。</div></td></tr>') + "</tbody></table></div>" +
      "</div>";

    document.getElementById("view-stats").innerHTML = html;
  }

  function kpiCard(title, total, bucket, iconKey, tone) {
    return (
      '<div class="card kpi-card">' +
      '<div class="kpi-top"><h3>' + title + '</h3><span class="kpi-icon ' + tone + '">' + ICON[iconKey] + "</span></div>" +
      '<div class="kpi-value">' + total + "<small>次练习</small></div>" +
      '<div class="kpi-break">' +
      "<div><span>认识</span><b>" + bucket.known + "</b></div>" +
      "<div><span>不熟悉</span><b>" + bucket.unfamiliar + "</b></div>" +
      "<div><span>不认识</span><b>" + bucket.unknown + "</b></div>" +
      "</div>" +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* Library                                                             */
  /* ------------------------------------------------------------------ */

  function libraryCategories() {
    const data = libraryTab === "words" ? WORD_DATA : PHRASE_DATA;
    const categories = [];
    data.forEach((item) => {
      if (categories.indexOf(item.cat) === -1) categories.push(item.cat);
    });
    return ["全部"].concat(categories);
  }

  function renderLibrary() {
    const isWords = libraryTab === "words";
    const tabs = [
      { key: "words", label: "单词", count: WORD_DATA.length },
      { key: "phrases", label: "短句", count: PHRASE_DATA.length }
    ];
    const categories = libraryCategories();
    const learnedWords = Object.keys(state.progress.words).length;
    const learnedPhrases = Object.keys(state.progress.phrases).length;

    const html =
      '<div class="page-head"><h1>词库</h1><p>完整浏览 SAP HCM、职场与生活词汇及项目短句，支持主题筛选、搜索和朗读。</p></div>' +
      '<div class="library-summary">' +
      '<div class="lib-stat"><b>' + WORD_DATA.length + '</b><span>单词总量</span></div>' +
      '<div class="lib-stat"><b>' + learnedWords + '</b><span>已学单词</span></div>' +
      '<div class="lib-stat"><b>' + PHRASE_DATA.length + '</b><span>短句总量</span></div>' +
      '<div class="lib-stat"><b>' + learnedPhrases + '</b><span>已学短句</span></div>' +
      "</div>" +
      '<div class="library-toolbar">' +
      '<div class="tabs">' + tabs.map((tab) =>
        '<button type="button" data-library-tab="' + tab.key + '" class="' + (libraryTab === tab.key ? "is-active" : "") + '">' +
        tab.label + "<b>" + tab.count + "</b></button>"
      ).join("") + "</div>" +
      '<div class="search-box">' + ICON.search +
      '<input type="search" id="librarySearch" placeholder="搜索英文或中文释义" value="' + escapeHtml(libraryQuery) + '" autocomplete="off" /></div>' +
      "</div>" +
      '<div class="filter-chips">' + categories.map((cat) =>
        '<button type="button" class="filter-chip' + (libraryCategory === cat ? " is-active" : "") + '" data-library-cat="' + escapeHtml(cat) + '">' + escapeHtml(cat) + "</button>"
      ).join("") + "</div>" +
      '<div id="libraryResults"></div>';

    document.getElementById("view-library").innerHTML = html;
    renderLibraryResults();

    const search = document.getElementById("librarySearch");
    if (search) {
      search.addEventListener("input", (event) => {
        libraryQuery = event.target.value;
        libraryLimit = 60;
        renderLibraryResults();
      });
    }
  }

  function renderLibraryResults() {
    const container = document.getElementById("libraryResults");
    if (!container) return;
    const isWords = libraryTab === "words";
    const data = isWords ? WORD_DATA : PHRASE_DATA;
    const type = isWords ? "words" : "phrases";
    const query = libraryQuery.trim().toLowerCase();

    const items = data.filter((item) => {
      if (libraryCategory !== "全部" && item.cat !== libraryCategory) return false;
      if (!query) return true;
      return item.en.toLowerCase().indexOf(query) !== -1 || item.zh.indexOf(libraryQuery.trim()) !== -1;
    });

    const cards = items.slice(0, libraryLimit).map((item) => {
      const record = state.progress[type][item.id];
      const next = record && record.nextReview ? formatDayCN(dayKeyFromTs(record.nextReview)) : "";
      return (
        '<article class="lib-card">' +
        '<div class="lib-main">' +
        '<div class="lib-en">' + escapeHtml(item.en) + "</div>" +
        '<div class="lib-zh">' + escapeHtml(item.zh) + "</div>" +
        (isWords ? '<p class="lib-ex" title="' + escapeHtml(item.ex) + '">' + escapeHtml(item.ex) + "</p>" : "") +
        '<div class="lib-meta">' +
        '<span class="chip chip-cat">' + escapeHtml(item.cat) + "</span>" +
        (record
          ? '<span class="chip chip-' + record.status + '">' + statusLabel(record.status) + "</span>"
          : '<span class="chip chip-muted">未学习</span>') +
        (isWords ? '<span class="lib-next">' + escapeHtml(item.pos) + "</span>" : "") +
        (next ? '<span class="lib-next">下次复习 ' + next + "</span>" : "") +
        "</div>" +
        "</div>" +
        '<button class="icon-btn" data-speak="' + escapeHtml(item.en) + '" title="朗读">' + ICON.speaker + "</button>" +
        "</article>"
      );
    }).join("");

    container.innerHTML =
      '<div class="book-count" style="margin:0 0 10px">共 <b>' + items.length + "</b> " + (isWords ? "个单词" : "条短句") + "，已显示 " + Math.min(items.length, libraryLimit) + " 条</div>" +
      (items.length
        ? '<div class="library-grid">' + cards + "</div>" +
          (items.length > libraryLimit
            ? '<div class="library-more"><button class="btn btn-ghost" type="button" data-action="library-more">加载更多（剩余 ' + (items.length - libraryLimit) + " 条）</button></div>"
            : "")
        : '<div class="card empty-state">' + ICON.layers + "<h3>没有匹配内容</h3><p>换个关键词，或切换到「全部」主题再看看。</p></div>");
  }

  /* ------------------------------------------------------------------ */
  /* Word book                                                           */
  /* ------------------------------------------------------------------ */

  function renderBook() {
    const counts = bookCounts();
    const tabs = [
      { key: "all", label: "全部", count: counts.all },
      { key: "unknown", label: "不认识", count: counts.unknown },
      { key: "unfamiliar", label: "不熟悉", count: counts.unfamiliar }
    ];
    const html =
      '<div class="page-head"><h1>生词本</h1><p>集中查看标记为「不熟悉 / 不认识」的单词，支持快速检索与朗读。</p></div>' +
      '<div class="book-toolbar">' +
      '<div class="tabs">' + tabs.map((tab) =>
        '<button type="button" data-book-filter="' + tab.key + '" class="' + (bookFilter === tab.key ? "is-active" : "") + '">' +
        tab.label + "<b>" + tab.count + "</b></button>"
      ).join("") + "</div>" +
      '<div class="search-box">' + ICON.search +
      '<input type="search" id="bookSearch" placeholder="搜索英文或中文释义" value="' + escapeHtml(bookQuery) + '" autocomplete="off" /></div>' +
      "</div>" +
      '<div id="bookResults"></div>';

    document.getElementById("view-book").innerHTML = html;
    renderBookResults();

    const search = document.getElementById("bookSearch");
    if (search) {
      search.addEventListener("input", (event) => {
        bookQuery = event.target.value;
        renderBookResults();
      });
    }
  }

  function renderBookResults() {
    const container = document.getElementById("bookResults");
    if (!container) return;
    const items = bookItems(bookFilter, bookQuery);
    let list = "";

    if (items.length === 0) {
      list =
        '<div class="card empty-state">' + ICON.book +
        "<h3>" + (bookQuery ? "没有匹配的生词" : "这里还很干净") + "</h3>" +
        "<p>" + (bookQuery ? "换个关键词试试，或清空搜索条件。" : "学习时选择「不认识」或「不熟悉」的单词会自动收录到这里。") + "</p>" +
        "</div>";
    } else {
      list = '<div class="book-list">' + items.map((word) => {
        const record = state.progress.words[word.id];
        const next = record.nextReview ? formatDayCN(dayKeyFromTs(record.nextReview)) : "—";
        return (
          '<div class="book-row">' +
          '<button class="icon-btn book-speak" data-speak="' + escapeHtml(word.en) + '" title="朗读">' + ICON.speaker + "</button>" +
          '<div class="book-main">' +
          '<div class="book-word">' + escapeHtml(word.en) + "</div>" +
          '<div class="book-zh">' + escapeHtml(word.zh) + "</div>" +
          '<div class="book-meta">' +
          '<span class="chip ' + (record.status === "unknown" ? "chip-unknown" : "chip-unfamiliar") + '">' + statusLabel(record.status) + "</span>" +
          '<span class="chip chip-cat">' + escapeHtml(word.cat) + "</span>" +
          "<span>下次复习 " + next + "</span>" +
          "<span>已复习 " + (record.reviews || 1) + " 次</span>" +
          "</div>" +
          "</div>" +
          '<div class="book-actions"><button class="btn btn-ghost btn-sm" data-action="mark-known" data-id="' + word.id + '">' + ICON.check + "标记认识</button></div>" +
          "</div>"
        );
      }).join("") + "</div>";
    }

    container.innerHTML =
      '<div class="book-count" style="margin:0 0 10px">当前显示 <b>' + items.length + "</b> 个生词</div>" + list;
  }

  function markKnown(id) {
    const record = state.progress.words[id];
    const word = WORD_MAP.get(id);
    if (!record || !word) return;
    record.status = "known";
    record.lastReview = Date.now();
    record.nextReview = dayStart() + intervalFor("known") * DAY_MS;
    saveState();
    renderCurrentView();
    updateChrome();
    showToast("「" + word.en + "」已移出生词本，将在 " + intervalFor("known") + " 天后复习");
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function renderSettings() {
    const counts = bookCounts();
    const mastered = Object.keys(state.progress.words).filter((id) => state.progress.words[id].status === "known").length;
    const days = Object.keys(state.daily).length;
    const voiceOptions = voices.length
      ? voices.map((voice) =>
        '<option value="' + escapeHtml(voice.name) + '"' + (state.settings.voice === voice.name ? " selected" : "") + ">" +
        escapeHtml(voice.name + " (" + voice.lang + ")") + "</option>"
      ).join("")
      : '<option value="">暂无可用语音</option>';

    const html =
      '<div class="page-head"><h1>设置</h1><p>调整每日学习量、复习间隔与朗读偏好，所有设置会保存在本机。</p></div>' +
      '<div class="settings-grid">' +

      '<div class="card settings-card">' +
      "<h3>学习计划</h3><p>每日新学数量，到期复习不受此限制。</p>" +
      settingRow("每日新词量", "完成后仍会继续安排到期复习", '<input class="number-input" type="number" min="1" max="60" step="1" value="' + quotaFor("words") + '" data-setting="wordsPerDay" />') +
      settingRow("每日新短句量", "建议 3 – 10 句，保持稳定输出", '<input class="number-input" type="number" min="1" max="30" step="1" value="' + quotaFor("phrases") + '" data-setting="phrasesPerDay" />') +
      "</div>" +

      '<div class="card settings-card">' +
      "<h3>复习间隔</h3><p>根据记忆程度自动安排下一次出现时间。</p>" +
      '<div class="interval-grid">' +
      '<div class="interval-item"><label>认识</label><div class="input-line"><input type="number" min="1" max="365" step="1" value="' + state.settings.knownDays + '" data-setting="knownDays" /><span>天后</span></div></div>' +
      '<div class="interval-item"><label>不熟悉</label><div class="input-line"><input type="number" min="1" max="60" step="1" value="' + state.settings.unfamiliarDays + '" data-setting="unfamiliarDays" /><span>天后</span></div></div>' +
      '<div class="interval-item"><label>不认识</label><div class="input-line"><input type="number" min="1" max="30" step="1" value="' + state.settings.unknownDays + '" data-setting="unknownDays" /><span>天后</span></div></div>' +
      "</div>" +
      '<p class="settings-note">「不认识」默认 1 天，即第二天再次出现；「不熟悉」默认 3 天；「认识」默认 60 天。</p>' +
      "</div>" +

      '<div class="card settings-card">' +
      "<h3>朗读设置</h3><p>使用浏览器内置语音引擎朗读英文内容。</p>" +
      settingRow("自动朗读", "进入新卡片时自动朗读英文", '<label class="switch"><input type="checkbox" data-setting="autoSpeak"' + (state.settings.autoSpeak ? " checked" : "") + " /><i></i></label>") +
      settingRow("朗读语速", "较慢的语速更适合跟读", '<div class="range-row"><input type="range" min="0.6" max="1.2" step="0.05" value="' + state.settings.rate + '" data-setting="rate" /><span class="range-value">' + Number(state.settings.rate).toFixed(2) + "x</span></div>") +
      settingRow("语音", "优先使用英语发音", '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><select class="select-input" data-setting="voice">' + voiceOptions + '</select><button class="btn btn-ghost btn-sm" data-action="test-voice">试听</button></div>') +
      "</div>" +

      '<div class="card settings-card">' +
      "<h3>学习数据</h3><p>数据先保存在本机浏览器，登录后同步到云端。</p>" +
      settingRow("已掌握单词", "标记为「认识」且已进入长间隔复习", "<b>" + mastered + " 个</b>") +
      settingRow("生词本", "不熟悉 + 不认识", "<b>" + counts.all + " 个</b>") +
      settingRow("学习天数", "有学习记录的天数", "<b>" + days + " 天</b>") +
      '<div class="danger-row" style="margin-top:16px"><div><strong>清空学习记录</strong><span>删除进度、统计与生词本，设置将保留</span></div>' +
      '<button class="btn btn-danger btn-sm" data-action="reset-data">清空数据</button></div>' +
      "</div>" +

      '<div class="card settings-card">' +
      "<h3>备份与迁移</h3><p>导出的 JSON 文件可以换设备导入，也是云端不可用时的保底。</p>" +
      '<div class="backup-row">' +
      '<button class="btn btn-ghost btn-sm" data-action="export-data">导出进度</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="import-data">导入进度</button>' +
      "</div>" +
      '<p class="settings-note">导出后可通过微信/邮件传给自己，在另一台设备的设置页导入即可。</p>' +
      "</div>" +

      "</div>";

    document.getElementById("view-settings").innerHTML = html;
  }

  function settingRow(label, hint, control) {
    return (
      '<div class="setting-row"><div class="setting-label"><strong>' + label + "</strong><span>" + hint + "</span></div>" +
      "<div>" + control + "</div></div>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* Routing & render                                                    */
  /* ------------------------------------------------------------------ */

  function renderCurrentView() {
    if (currentView === "dashboard") renderDashboard();
    else if (currentView === "words") renderStudy("words");
    else if (currentView === "phrases") renderStudy("phrases");
    else if (currentView === "library") renderLibrary();
    else if (currentView === "stats") renderStats();
    else if (currentView === "book") renderBook();
    else if (currentView === "settings") renderSettings();
    updateChrome();
  }

  function applyRoute() {
    const raw = (window.location.hash || "").replace(/^#\/?/, "");
    const view = ["dashboard", "words", "phrases", "library", "stats", "book", "settings"].indexOf(raw) !== -1 ? raw : "dashboard";
    currentView = view;

    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("is-active", section.id === "view-" + view);
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("is-active", item.getAttribute("data-nav") === view);
    });

    renderCurrentView();
    window.scrollTo(0, 0);
  }

  function navigate(view) {
    if (view === currentView && window.location.hash === "#/" + view) {
      renderCurrentView();
      return;
    }
    window.location.hash = "#/" + view;
  }

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
  }

  function openConfirm(title, desc, action) {
    const modal = document.getElementById("modal");
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalDesc").textContent = desc;
    modalAction = action;
    modal.hidden = false;
  }

  function closeModal() {
    const modal = document.getElementById("modal");
    modal.hidden = true;
    modalAction = null;
  }

  function resetProgress() {
    const settings = state.settings;
    state = createDefaultState();
    state.settings = settings;
    ["words", "phrases"].forEach((type) => {
      state.session[type] = { date: "", ids: [], index: 0 };
    });
    saveState();
    closeModal();
    renderCurrentView();
    showToast("学习记录已清空");
  }

  function exportProgress() {
    const payload = {
      app: "sap-hcm-english",
      version: state.version || 1,
      exportedAt: new Date().toISOString(),
      state: state
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "sap-hcm-english-progress-" + dateKey() + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("进度已导出，请妥善保存文件");
    } catch (err) {
      console.warn("导出失败", err);
      showToast("导出失败，请重试");
    }
  }

  function importProgress() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let incoming = null;
        try {
          const parsed = JSON.parse(String(reader.result || ""));
          incoming = parsed && parsed.state ? parsed.state : parsed;
        } catch (err) {
          showToast("读取失败：不是有效的 JSON 文件");
          return;
        }
        if (!incoming || !incoming.progress || !incoming.settings) {
          showToast("文件格式不正确，请选择本应用导出的 JSON");
          return;
        }
        openConfirm("导入学习进度", "将用文件中的进度覆盖当前进度，此操作不可撤销。", () => {
          const base = createDefaultState();
          state = {
            ...base,
            ...incoming,
            settings: { ...base.settings, ...(incoming.settings || {}) },
            progress: {
              words: { ...(incoming.progress && incoming.progress.words) },
              phrases: { ...(incoming.progress && incoming.progress.phrases) }
            },
            daily: incoming.daily && typeof incoming.daily === "object" ? incoming.daily : {},
            session: {
              words: { date: "", ids: [], index: 0 },
              phrases: { date: "", ids: [], index: 0 }
            },
            streak: { ...base.streak, ...(incoming.streak || {}) }
          };
          saveState();
          closeModal();
          renderCurrentView();
          showToast("进度已导入");
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function updateSetting(key, rawValue) {
    if (key === "autoSpeak") {
      state.settings.autoSpeak = Boolean(rawValue);
    } else if (key === "rate") {
      state.settings.rate = clamp(Number(rawValue) || 0.9, 0.6, 1.2);
    } else if (key === "voice") {
      state.settings.voice = String(rawValue || "");
    } else {
      const value = Math.round(Number(rawValue));
      const limits = {
        wordsPerDay: [1, 60],
        phrasesPerDay: [1, 30],
        knownDays: [1, 365],
        unfamiliarDays: [1, 60],
        unknownDays: [1, 30]
      };
      const range = limits[key] || [1, 365];
      state.settings[key] = clamp(Number.isFinite(value) ? value : range[0], range[0], range[1]);
    }

    if (key === "wordsPerDay" || key === "phrasesPerDay") {
      const type = key === "wordsPerDay" ? "words" : "phrases";
      const session = state.session[type];
      if (session.date === dateKey() && session.index === 0) {
        session.ids = buildQueue(type);
      }
    }

    saveState();
    updateChrome();

    if (currentView === "settings") {
      renderSettings();
    } else if (currentView === "dashboard") {
      renderDashboard();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      navigate(nav.getAttribute("data-nav"));
      return;
    }

    const speakBtn = event.target.closest("[data-speak]");
    if (speakBtn) {
      event.stopPropagation();
      speak(speakBtn.getAttribute("data-speak"));
      return;
    }

    const resultBtn = event.target.closest("[data-result]");
    if (resultBtn) {
      const type = currentView === "phrases" ? "phrases" : "words";
      answerCard(type, resultBtn.getAttribute("data-result"));
      return;
    }

    const card = event.target.closest(".study-card");
    if (card && !event.target.closest("button")) {
      const id = card.getAttribute("data-card");
      revealedId = revealedId === id ? null : id;
      renderStudy(currentView === "phrases" ? "phrases" : "words");
      return;
    }

    const rangeBtn = event.target.closest("[data-range]");
    if (rangeBtn) {
      statsRange = rangeBtn.getAttribute("data-range");
      renderStats();
      return;
    }

    const filterBtn = event.target.closest("[data-book-filter]");
    if (filterBtn) {
      bookFilter = filterBtn.getAttribute("data-book-filter");
      renderBook();
      return;
    }

    const libraryTabBtn = event.target.closest("[data-library-tab]");
    if (libraryTabBtn) {
      libraryTab = libraryTabBtn.getAttribute("data-library-tab");
      libraryCategory = "全部";
      libraryQuery = "";
      libraryLimit = 60;
      renderLibrary();
      return;
    }

    const libraryCatBtn = event.target.closest("[data-library-cat]");
    if (libraryCatBtn) {
      libraryCategory = libraryCatBtn.getAttribute("data-library-cat");
      libraryLimit = 60;
      renderLibrary();
      return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (!actionBtn) return;
    const action = actionBtn.getAttribute("data-action");

    if (action === "start-words") navigate("words");
    else if (action === "start-phrases") navigate("phrases");
    else if (action === "mark-known") markKnown(actionBtn.getAttribute("data-id"));
    else if (action === "library-more") {
      libraryLimit += 60;
      renderLibraryResults();
    }
    else if (action === "test-voice") speak("Personnel Administration is stored in the SAP HCM system.");
    else if (action === "export-data") exportProgress();
    else if (action === "import-data") importProgress();
    else if (action === "reset-data") {
      openConfirm("清空学习记录", "将删除全部学习进度、统计数据和生词本内容，此操作不可撤销。设置项会保留。", resetProgress);
    } else if (action === "continue-study") {
      const wordSession = ensureSession("words");
      if (wordSession.index < wordSession.ids.length) {
        navigate("words");
      } else {
        const phraseSession = ensureSession("phrases");
        navigate(phraseSession.index < phraseSession.ids.length ? "phrases" : "words");
      }
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || !target.getAttribute) return;
    const key = target.getAttribute("data-setting");
    if (!key) return;
    if (target.type === "checkbox") updateSetting(key, target.checked);
    else updateSetting(key, target.value);
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || !target.getAttribute) return;
    if (target.getAttribute("data-setting") === "rate") {
      const display = target.parentElement.querySelector(".range-value");
      if (display) display.textContent = Number(target.value).toFixed(2) + "x";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (!document.getElementById("modal").hidden) {
      if (event.key === "Escape") closeModal();
      return;
    }
    if (currentView !== "words" && currentView !== "phrases") {
      if (event.key === "Escape") closeModal();
      return;
    }
    const session = state.session[currentView];
    if (!session || session.index >= session.ids.length) return;

    if (event.code === "Space") {
      event.preventDefault();
      const id = session.ids[session.index];
      revealedId = revealedId === id ? null : id;
      renderStudy(currentView);
    } else if (event.key === "1") {
      answerCard(currentView, "unknown");
    } else if (event.key === "2") {
      answerCard(currentView, "unfamiliar");
    } else if (event.key === "3") {
      answerCard(currentView, "known");
    }
  });

  document.getElementById("modal").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-modal]");
    if (btn) {
      if (btn.getAttribute("data-modal") === "ok" && typeof modalAction === "function") {
        modalAction();
      } else {
        closeModal();
      }
      return;
    }
    if (event.target.id === "modal") closeModal();
  });

  window.addEventListener("hashchange", applyRoute);

  /* ------------------------------------------------------------------ */
  /* Auth UI helpers                                                     */
  /* ------------------------------------------------------------------ */

  function showAuthOverlay() {
    const overlay = document.getElementById("authOverlay");
    overlay.hidden = false;
    document.getElementById("authHint").textContent = "";
    const input = document.getElementById("authToken");
    if (input) {
      input.value = "";
      setTimeout(() => input.focus(), 50);
    }
  }

  function hideAuthOverlay() {
    const overlay = document.getElementById("authOverlay");
    if (overlay) overlay.hidden = true;
  }

  function updateSyncChrome() {
    const syncLabel = document.getElementById("syncLabel");
    const syncDot = document.getElementById("syncDot");
    const userChip = document.getElementById("userChip");
    const userEmail = document.getElementById("userEmail");
    const userAvatar = document.getElementById("userAvatar");
    const loginBtn = document.getElementById("loginBtn");
    const sync = window.AuthSync ? window.AuthSync.getSyncStatus() : { authed: false, online: navigator.onLine };

    if (sync.authed) {
      syncLabel.textContent = sync.online ? "GitHub 同步中" : "离线 · 本地存储";
      syncDot.classList.toggle("is-live", sync.online);
      syncDot.classList.toggle("is-offline", !sync.online);
      const login = sync.login || "github";
      userEmail.textContent = "@" + login;
      userAvatar.textContent = login.charAt(0).toUpperCase();
      userChip.hidden = false;
      loginBtn.hidden = true;
    } else {
      syncLabel.textContent = "仅本机存储 · 连接 GitHub 可同步";
      syncDot.classList.remove("is-live", "is-offline");
      userChip.hidden = true;
      loginBtn.hidden = false;
    }
  }

  // Auth overlay 内部事件
  document.addEventListener("click", (ev) => {
    if (ev.target.id === "authSkip") {
      hideAuthOverlay();
      return;
    }
    if (ev.target.id === "loginBtn") {
      showAuthOverlay();
      return;
    }
    if (ev.target.id === "userChip") {
      openConfirm("断开 GitHub 同步", "云端 Gist 里的进度会保留，下次连接同一个账号会继续同步。", () => {
        if (window.AuthSync) window.AuthSync.disconnect();
        closeModal();
      });
      return;
    }
  });

  document.addEventListener("submit", async (ev) => {
    if (ev.target && ev.target.id === "authForm") {
      ev.preventDefault();
      const input = document.getElementById("authToken");
      const token = input.value.trim();
      const hint = document.getElementById("authHint");
      const btn = document.getElementById("authSubmit");
      hint.textContent = "";
      btn.disabled = true;
      btn.textContent = "连接中…";
      try {
        await window.AuthSync.connect(token);
      } catch (err) {
        hint.textContent = err && err.message ? err.message : "连接失败，请重试。";
        btn.disabled = false;
        btn.textContent = "连接 GitHub 同步";
        return;
      }
      btn.disabled = false;
      btn.textContent = "连接 GitHub 同步";
      hideAuthOverlay();
      showToast("已连接 GitHub，进度开始同步");
    }
  });

  // AuthSync 事件监听
  document.addEventListener("auth:success", () => {
    updateSyncChrome();
    saveState(); // 登录后立即推一次
  });
  document.addEventListener("auth:logout", () => {
    updateSyncChrome();
    showToast("已退出登录");
  });
  document.addEventListener("sync:pulled-newer", (ev) => {
    if (ev.detail && ev.detail.state) {
      state = ev.detail.state;
      applyRoute(); // 重新渲染所有视图
      showToast("已从云端同步最新进度");
    }
  });
  document.addEventListener("sync:pushed", () => {
    const s = window.AuthSync.getSyncStatus();
    const label = document.getElementById("syncLabel");
    if (label) {
      label.textContent = "云端同步中 · 刚刚";
    }
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  // 初始化同步层（恢复 session，后台拉云端）
  if (window.AuthSync && typeof window.AuthSync.init === "function") {
    try { window.AuthSync.init(); } catch (e) { console.warn(e); }
  }

  // 首次加载：如果还没连接 GitHub，延迟 400ms 弹连接窗
  setTimeout(() => {
    const connected = !!(window.AuthSync && window.AuthSync.getSession());
    if (!connected) {
      showAuthOverlay();
    }
    updateSyncChrome();
  }, 400);

  if (!window.location.hash) {
    window.location.hash = "#/dashboard";
  }
  applyRoute();
})();
