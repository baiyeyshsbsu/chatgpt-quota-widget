/* ChatGPT LED Widget — renderer
 * Fetches the local ChatGPT (desktop) weekly quota and renders a liquid-glass LED widget.
 * Only the 7-day (weekly) quota is shown.
 */
(function () {
  "use strict";

  const REFRESH_INTERVAL_MS = 120000; // 2 minutes
  const ACCOUNTS_PER_PAGE = 4;

  const STR = {
    zh: {
      brand: "ChatGPT 额度",
      loading: "读取中",
      remaining: "剩余",
      weekly: "一周",
      plan: "套餐",
      statusLoading: "正在读取 ChatGPT 额度…",
      statusNoReset: "等待重置时间",
      statusReset: (when) => `重置于 ${when}`,
      exhausted: "额度已用尽（剩余 0%）",
      error: "无法读取额度，请确认 ChatGPT 桌面版已安装并登录",
      planUnknown: "未知",
      stateLoading: "读取中",
      stateOk: "额度充足",
      stateWarn: "额度偏低",
      stateError: "不可用",
      langToggle: "EN",
      quotaExhaustedShort: "已用尽",
      accounts: "账号管理",
      accountsSection: "账户概览",
      backToQuota: "返回额度",
      accountSummary: (count) => `${count} 个账号`,
      addAccount: "+ 账号",
      addAccountPrompt: "请输入账号备注名（将绑定当前登录账号）：",
      remove: "删除",
      bindCurrent: "绑定当前账号",
      active: "当前",
      saveReading: "识别并更新",
      resetCount: "可重置次数",
      resetAt: "重置",
      lastRefreshed: "刷新",
      nextReset: "下次重置",
      updatedAt: "更新于",
      resetToday: "即将刷新",
      noActive: "未选择账号，无法保存",
      saved: "已保存读数",
      saveFailed: "保存失败：",
      confirmRemove: "确定删除该账号？",
      remainingUnknown: "--",
      unbound: "未绑定",
      detectedUnregistered: "检测到未添加的账号",
      bindFailed: "绑定失败：",
      previousPage: "上一页",
      nextPage: "下一页"
    },
    en: {
      brand: "ChatGPT Quota",
      loading: "Loading",
      remaining: "left",
      weekly: "Weekly",
      plan: "Plan",
      statusLoading: "Reading ChatGPT quota…",
      statusNoReset: "Waiting for reset time",
      statusReset: (when) => `Resets ${when}`,
      exhausted: "Quota exhausted (0% left)",
      error: "Cannot read quota. Make sure the ChatGPT desktop app is installed and signed in.",
      planUnknown: "Unknown",
      stateLoading: "Loading",
      stateOk: "Plenty left",
      stateWarn: "Low quota",
      stateError: "Unavailable",
      langToggle: "中文",
      quotaExhaustedShort: "Exhausted",
      accounts: "Accounts",
      accountsSection: "Overview",
      backToQuota: "Back to quota",
      accountSummary: (count) => `${count} account${count === 1 ? "" : "s"}`,
      addAccount: "+ Account",
      addAccountPrompt: "Enter a label (binds the currently signed-in account):",
      remove: "Remove",
      bindCurrent: "Bind current",
      active: "Active",
      saveReading: "Detect and update",
      resetCount: "Reset count",
      resetAt: "Resets",
      lastRefreshed: "Refreshed",
      nextReset: "Next reset",
      updatedAt: "Updated",
      resetToday: "Resetting soon",
      noActive: "No account selected; cannot save",
      saved: "Reading saved",
      saveFailed: "Save failed: ",
      confirmRemove: "Delete this account?",
      remainingUnknown: "--",
      unbound: "Unbound",
      detectedUnregistered: "Unregistered account detected",
      bindFailed: "Bind failed: ",
      previousPage: "Previous",
      nextPage: "Next"
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
    statusText: $("statusText"),
    accountsBtn: $("accountsBtn"),
    accountsPanel: $("accountsPanel"),
    accountsTitle: $("accountsTitle"),
    accountsList: $("accountsList"),
    accountsPagination: $("accountsPagination"),
    previousAccountsPageBtn: $("previousAccountsPageBtn"),
    accountsPageText: $("accountsPageText"),
    nextAccountsPageBtn: $("nextAccountsPageBtn"),
    addAccountBtn: $("addAccountBtn"),
    saveReadingBtn: $("saveReadingBtn"),
    toast: $("toast")
  };

  let lang = (safeGetLang() || (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en");
  let fetching = false;
  let lastData = null;
  let resetTimer = null;
  let pollTimer = null;
  let countdownTimer = null;
  let pinActive = true;
  let currentView = "led";
  let accountPage = 0;

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

  function formatResetCountdown(iso) {
    if (!iso) return "";
    const resetTime = new Date(iso).getTime();
    if (!Number.isFinite(resetTime)) return "";
    const totalMinutes = Math.ceil((resetTime - Date.now()) / (60 * 1000));
    if (totalMinutes <= 0) return STR[lang].resetToday;
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (lang === "zh") {
      if (days > 0) return `${days}天${hours % 24}小时后`;
      if (hours > 0) return `${hours}小时${minutes}分钟后`;
      return `${minutes}分钟后`;
    }
    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${minutes}m`;
  }

  function countdownUrgency(iso) {
    if (!iso) return "normal";
    const minutes = Math.ceil((new Date(iso).getTime() - Date.now()) / (60 * 1000));
    if (!Number.isFinite(minutes)) return "normal";
    if (minutes <= 120) return "danger";
    if (minutes <= 24 * 60) return "warning";
    return "normal";
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
    els.accountsTitle.textContent = STR[lang].accountsSection;
    els.addAccountBtn.textContent = STR[lang].addAccount;
    els.saveReadingBtn.textContent = STR[lang].saveReading;
    els.previousAccountsPageBtn.textContent = STR[lang].previousPage;
    els.nextAccountsPageBtn.textContent = STR[lang].nextPage;
    syncViewLabels();
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }

  function syncViewLabels() {
    const label = currentView === "accounts" ? STR[lang].backToQuota : STR[lang].accounts;
    els.accountsBtn.title = label;
    els.accountsBtn.setAttribute("aria-label", label);
  }

  function renderQuota(data) {
    lastData = data;
    if (currentView === "led") {
      els.brandName.textContent = data.account?.label
        ? `${data.account.label} · ${STR[lang].brand}`
        : STR[lang].brand;
    }
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
      const countdown = formatResetCountdown(resetsAt);
      els.secondaryText.textContent = countdown || STR[lang].statusNoReset;
      const when = formatReset(resetsAt);
      els.statusText.textContent = when
        ? STR[lang].statusReset(when)
        : STR[lang].statusNoReset;
    }

    if (data.account?.hint && !data.account.recognized) {
      els.statusText.textContent = `${STR[lang].detectedUnregistered} · ${data.account.hint}`;
    }

    els.planText.textContent = planName(data.planType);
    if (currentView === "led") {
      els.brandState.textContent =
        state === "ok" ? STR[lang].stateOk : state === "warn" ? STR[lang].stateWarn : STR[lang].stateError;
    }

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

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setView(view) {
    currentView = view;
    document.body.dataset.view = view;
    syncViewLabels();
    els.accountsPanel.hidden = view !== "accounts";
    if (view === "accounts") {
      accountPage = 0;
      els.brandName.textContent = STR[lang].accounts;
      els.brandState.textContent = "";
      window.chatgptQuota.setView({ view: "accounts" });
      renderAccounts();
    } else {
      window.chatgptQuota.setView("led");
      if (lastData) renderQuota(lastData);
      else applyStaticText();
    }
  }

  async function renderAccounts() {
    try {
      const accounts = await window.chatgptQuota.getAccounts();
      const active = await window.chatgptQuota.getActiveAccount();
      els.brandName.textContent = STR[lang].accounts;
      els.brandState.textContent = STR[lang].accountSummary(accounts.length);
      const sortedAccounts = accounts.slice().sort((a, b) => {
        if (active && a.id === active.id) return -1;
        if (active && b.id === active.id) return 1;
        return 0;
      });
      const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / ACCOUNTS_PER_PAGE));
      accountPage = Math.max(0, Math.min(accountPage, totalPages - 1));
      const pageAccounts = sortedAccounts.slice(
        accountPage * ACCOUNTS_PER_PAGE,
        (accountPage + 1) * ACCOUNTS_PER_PAGE
      );
      els.accountsList.innerHTML = "";
      for (const acc of pageAccounts) {
        const row = document.createElement("div");
        const isExhausted = Number(acc.remainingPercent) === 0;
        row.className =
          "account-row" +
          (active && acc.id === active.id ? " active" : "") +
          (isExhausted ? " exhausted" : "");
        const countdown = formatResetCountdown(acc.resetsAt);
        const urgency = countdownUrgency(acc.resetsAt);
        row.innerHTML =
          '<div class="account-head">' +
          '<div class="account-identity"><span class="account-label">' + escapeHtml(acc.label) + "</span>" +
          (active && acc.id === active.id
            ? '<span class="account-active-badge">' + STR[lang].active + "</span>"
            : "") +
          '</div><strong class="account-quota">' +
          (acc.remainingPercent == null ? STR[lang].remainingUnknown : acc.remainingPercent + "%") +
          "</strong></div>" +
          '<div class="account-reset"><span class="account-detail-label">' + STR[lang].nextReset +
          '</span><strong class="reset-date-value">' + (formatReset(acc.resetsAt) || "--") + "</strong>" +
          (countdown ? '<span class="reset-countdown ' + urgency + '">' + countdown + "</span>" : "") +
          "</div>" +
          '<div class="account-footer"><span class="refreshed-date">' + STR[lang].updatedAt + " " +
          (formatReset(acc.lastRefreshedAt) || "--") + '</span><div class="account-controls">' +
          '<label class="rc-label">' + STR[lang].resetCount +
          '<input type="number" min="0" step="1" class="rc-input" data-id="' + acc.id + '" value="' + (acc.resetCount || 0) + '" /></label>' +
          (!active || acc.id !== active.id
            ? '<button class="text-button bind-current" data-id="' + acc.id + '">' + STR[lang].bindCurrent + "</button>"
            : "") +
          '<button class="text-button danger remove" data-id="' + acc.id + '">' + STR[lang].remove + "</button>" +
          "</div></div>";
        els.accountsList.appendChild(row);
      }

      els.accountsPagination.hidden = totalPages <= 1;
      els.accountsPageText.textContent = `${accountPage + 1} / ${totalPages}`;
      els.previousAccountsPageBtn.disabled = accountPage === 0;
      els.nextAccountsPageBtn.disabled = accountPage >= totalPages - 1;

      els.accountsList.querySelectorAll(".rc-input").forEach((inp) =>
        inp.addEventListener("change", async () => {
          await window.chatgptQuota.setResetCount(inp.dataset.id, inp.value);
        })
      );
      els.accountsList.querySelectorAll(".bind-current").forEach((b) =>
        b.addEventListener("click", async () => {
          try {
            const result = await window.chatgptQuota.bindAccount(b.dataset.id);
            if (result?.quota) renderQuota(result.quota);
            showToast(STR[lang].saved);
            renderAccounts();
          } catch (e) {
            showToast(STR[lang].bindFailed + (e?.message || ""));
          }
        })
      );
      els.accountsList.querySelectorAll(".remove").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!window.confirm(STR[lang].confirmRemove)) return;
          await window.chatgptQuota.removeAccount(b.dataset.id);
          renderAccounts();
        })
      );

      els.saveReadingBtn.disabled = false;
      resizeAccountsView();
    } catch (_) {
      /* ignore render errors */
    }
  }

  function resizeAccountsView() {
    requestAnimationFrame(() => {
      if (currentView !== "accounts") return;
      const widget = document.querySelector(".widget");
      const height = Math.ceil(widget.offsetHeight);
      window.chatgptQuota.setView({ view: "accounts", height });
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  async function saveReading() {
    try {
      const data = await window.chatgptQuota.getQuota();
      renderQuota(data);
      showToast(STR[lang].saved);
      renderAccounts();
    } catch (e) {
      showToast(STR[lang].saveFailed + (e && e.message ? e.message : ""));
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

    els.accountsBtn.addEventListener("click", () =>
      setView(currentView === "led" ? "accounts" : "led")
    );
    els.addAccountBtn.addEventListener("click", async () => {
      const label = window.prompt(STR[lang].addAccountPrompt);
      if (label === null) return; // cancelled
      try {
        const result = await window.chatgptQuota.addAccount(label);
        if (result?.quota) renderQuota(result.quota);
        showToast(STR[lang].saved);
        accountPage = Number.MAX_SAFE_INTEGER;
        renderAccounts();
      } catch (e) {
        showToast(STR[lang].bindFailed + (e?.message || ""));
      }
    });
    els.previousAccountsPageBtn.addEventListener("click", () => {
      if (accountPage <= 0) return;
      accountPage -= 1;
      renderAccounts();
    });
    els.nextAccountsPageBtn.addEventListener("click", () => {
      accountPage += 1;
      renderAccounts();
    });
    els.saveReadingBtn.addEventListener("click", saveReading);
    if (window.chatgptQuota.onRefresh) window.chatgptQuota.onRefresh(() => refresh());
    if (window.chatgptQuota.onAlwaysOnTopChanged) {
      window.chatgptQuota.onAlwaysOnTopChanged((value) => setPin(Boolean(value)));
    }
  }

  function start() {
    document.body.dataset.view = "led";
    applyStaticText();
    wireControls();
    initPin();
    refresh();
    pollTimer = setInterval(() => refresh(), REFRESH_INTERVAL_MS);
    countdownTimer = setInterval(() => {
      if (lastData) renderQuota(lastData);
      if (currentView === "accounts") renderAccounts();
    }, 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
