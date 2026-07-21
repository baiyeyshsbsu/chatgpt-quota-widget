/* ChatGPT LED Widget — renderer
 * Fetches the local ChatGPT (desktop) weekly quota and renders a liquid-glass LED widget.
 * Only the 7-day (weekly) quota is shown.
 */
(function () {
  "use strict";

  const REFRESH_INTERVAL_MS = 120000; // 2 minutes

  const STR = {
    zh: {
      brand: "ChatGPT 额度",
      loading: "读取中",
      remaining: "剩余",
      weekly: "7天额度",
      plan: "计划",
      statusLoading: "正在读取 ChatGPT 额度…",
      noReset: (r) => `剩余 ${r}%`,
      ok: (r, when) => `剩余 ${r}% · 重置于 ${when}`,
      exhausted: "额度已用尽（剩余 0%）",
      error: "无法读取额度，请确认 ChatGPT 桌面版已安装并登录",
      planUnknown: "未知",
      stateLoading: "读取中",
      stateOk: "额度充足",
      stateWarn: "额度偏低",
      stateError: "不可用",
      langToggle: "EN",
      quotaExhaustedShort: "已用尽"
    },
    en: {
      brand: "ChatGPT Quota",
      loading: "Loading",
      remaining: "left",
      weekly: "7-day quota",
      plan: "Plan",
      statusLoading: "Reading ChatGPT quota…",
      noReset: (r) => `${r}% left`,
      ok: (r, when) => `${r}% left · resets ${when}`,
      exhausted: "Quota exhausted (0% left)",
      error: "Cannot read quota. Make sure the ChatGPT desktop app is installed and signed in.",
      planUnknown: "Unknown",
      stateLoading: "Loading",
      stateOk: "Plenty left",
      stateWarn: "Low quota",
      stateError: "Unavailable",
      langToggle: "中文",
      quotaExhaustedShort: "Exhausted"
    }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    body: document.body,
    trafficLight: $("trafficLight"),
    brandName: $("brandName"),
    brandState: $("brandState"),
    langBtn: $("langBtn"),
    pinBtn: $("pinBtn"),
    refreshBtn: $("refreshBtn"),
    minimizeBtn: $("minimizeBtn"),
    closeBtn: $("closeBtn"),
    liquidFill: $("liquidFill"),
    remaining: $("remaining"),
    remainingLabel: $("remainingLabel"),
    secondaryLabel: $("secondaryLabel"),
    secondaryText: $("secondaryText"),
    planLabel: $("planLabel"),
    planText: $("planText"),
    statusDot: $("statusDot"),
    statusText: $("statusText")
  };

  let lang = (safeGetLang() || (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en");
  let fetching = false;
  let lastData = null;
  let resetTimer = null;
  let pollTimer = null;
  let pinActive = true;

  function safeGetLang() {
    try {
      const v = localStorage.getItem("clw:lang");
      return v === "zh" || v === "en" ? v : null;
    } catch (_) {
      return null;
    }
  }

  function setState(state) {
    els.body.setAttribute("data-state", state);
  }

  function planName(planType) {
    if (!planType || planType === "unknown") return STR[lang].planUnknown;
    const map = { pro: "Pro", free: "Free", plus: "Plus", team: "Team", enterprise: "Enterprise" };
    return map[String(planType).toLowerCase()] || String(planType);
  }

  function formatReset(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function stateFor(remaining) {
    if (remaining == null) return "error";
    if (remaining >= 10) return "ok";
    if (remaining > 0) return "warn";
    return "error"; // 0 left
  }

  function applyStaticText() {
    els.brandName.textContent = STR[lang].brand;
    els.remainingLabel.textContent = STR[lang].remaining;
    els.secondaryLabel.textContent = STR[lang].weekly;
    els.planLabel.textContent = STR[lang].plan;
    els.langBtn.textContent = STR[lang].langToggle;
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }

  function renderQuota(data) {
    lastData = data;
    const sec = data.secondary;
    const remaining = data.remainingPercent != null ? data.remainingPercent : sec ? sec.remainingPercent : null;
    const resetsAt = data.resetsAt || (sec ? sec.resetsAt : null);

    if (remaining == null) {
      renderError("");
      return;
    }

    const state = stateFor(remaining);
    setState(state);
    els.liquidFill.style.setProperty("--level", remaining + "%");
    els.remaining.textContent = remaining + "%";

    if (remaining === 0) {
      els.secondaryText.textContent = STR[lang].quotaExhaustedShort;
      els.statusText.textContent = STR[lang].exhausted;
    } else {
      els.secondaryText.textContent =
        lang === "zh" ? `剩 ${remaining}%` : `${remaining}% left`;
      const when = formatReset(resetsAt);
      els.statusText.textContent = when
        ? STR[lang].ok(remaining, when)
        : STR[lang].noReset(remaining);
    }

    els.planText.textContent = planName(data.planType);
    els.brandState.textContent =
      state === "ok" ? STR[lang].stateOk : state === "warn" ? STR[lang].stateWarn : STR[lang].stateError;

    scheduleRefresh(resetsAt);
  }

  function renderError(msg) {
    lastData = null;
    setState("error");
    els.liquidFill.style.setProperty("--level", "0%");
    els.remaining.textContent = "--%";
    els.secondaryText.textContent = STR[lang].error;
    els.planText.textContent = STR[lang].planUnknown;
    els.statusText.textContent = msg ? `${STR[lang].error}（${msg}）` : STR[lang].error;
    els.brandState.textContent = STR[lang].stateError;
    scheduleRefresh(null);
  }

  function scheduleRefresh(resetsAtIso) {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    if (!resetsAtIso) return;
    const ms = new Date(resetsAtIso).getTime() - Date.now();
    if (ms > 0) {
      resetTimer = setTimeout(() => refresh(), Math.min(ms + 2000, 24 * 3600 * 1000));
    }
  }

  async function refresh() {
    if (fetching) return;
    fetching = true;
    setState("loading");
    els.brandState.textContent = STR[lang].stateLoading;
    els.statusText.textContent = STR[lang].statusLoading;
    try {
      const data = await window.chatgptQuota.getQuota();
      renderQuota(data);
    } catch (err) {
      renderError(err && err.message ? err.message : "");
    } finally {
      fetching = false;
    }
  }

  function setPin(active) {
    pinActive = active;
    els.pinBtn.classList.toggle("active", active);
    els.pinBtn.title = active ? "取消置顶" : "置顶";
  }

  async function initPin() {
    try {
      setPin(Boolean(await window.chatgptQuota.getAlwaysOnTop()));
    } catch (_) {
      setPin(true);
    }
  }

  function wireControls() {
    els.langBtn.addEventListener("click", () => {
      lang = lang === "zh" ? "en" : "zh";
      try {
        localStorage.setItem("clw:lang", lang);
      } catch (_) {}
      applyStaticText();
      if (lastData) renderQuota(lastData);
      else renderError("");
    });

    els.pinBtn.addEventListener("click", async () => {
      try {
        const next = await window.chatgptQuota.setAlwaysOnTop(!pinActive);
        setPin(Boolean(next));
      } catch (_) {
        setPin(!pinActive);
      }
    });

    els.refreshBtn.addEventListener("click", () => refresh());
    els.minimizeBtn.addEventListener("click", () => window.chatgptQuota.minimize());
    els.closeBtn.addEventListener("click", () => window.chatgptQuota.close());

    if (window.chatgptQuota.onRefresh) window.chatgptQuota.onRefresh(() => refresh());
    if (window.chatgptQuota.onAlwaysOnTopChanged) {
      window.chatgptQuota.onAlwaysOnTopChanged((value) => setPin(Boolean(value)));
    }
  }

  function start() {
    applyStaticText();
    wireControls();
    initPin();
    refresh();
    pollTimer = setInterval(() => refresh(), REFRESH_INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
