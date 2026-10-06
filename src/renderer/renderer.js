/* ChatGPT LED Widget — renderer
 * Fetches local or relay ChatGPT quota and renders a Fluent vertical quota rail.
 * The user can switch independently between 7-day and 5-hour windows.
 */
(function () {
  "use strict";

  const PERSONAL_REFRESH_INTERVAL_MS = 120000;
  const RELAY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const ACCOUNTS_PER_PAGE = 5;

  const STR = {
    zh: {
      brand: "ChatGPT 额度",
      loading: "读取中",
      remaining7d: "7天剩余",
      remaining5h: "5小时剩余",
      weekly: "重置",
      plan: "套餐",
      statusLoading: "正在读取 ChatGPT 额度…",
      statusNoReset: "等待重置时间",
      statusReset: (when) => `重置于 ${when}`,
      exhausted: "额度已用尽（剩余 0%）",
      error: "无法读取额度",
      staleReading: "暂时无法更新，已保留上次结果",
      errorKinds: {
        sub2api_network: "无法连接 Sub2API，请确认 Docker 正在运行",
        sub2api_auth: "Sub2API 尚未登录或登录已失效",
        sub2api_service: "Sub2API 返回异常",
        sub2api_probe_stale: "上游未产生新的额度快照",
        sub2api_empty: "Sub2API 中没有 OpenAI OAuth 账号",
        network: "疑似代理或网络连接异常",
        component_missing: "本机未找到 Codex 组件",
        component_start_failed: "本机 Codex 组件启动失败",
        auth: "Codex 登录已失效或尚未登录",
        service: "额度服务返回异常",
        unknown: "发生未知读取错误"
      },
      planUnknown: "未知",
      stateLoading: "读取中",
      stateOk: "额度充足",
      stateWarn: "额度偏低",
      stateError: "不可用",
      langToggle: "EN",
      quotaExhaustedShort: "已用尽",
      accounts: "账号管理",
      accountsShort: "账号",
      pinShort: "置顶",
      refreshShort: "刷新",
      hideShort: "隐藏",
      accountsSection: "个人主页",
      usageMode: "使用模式",
      personalMode: "个人使用",
      relayMode: "中转站",
      relayRemaining: "全部账号剩余",
      relayRemaining7d: "全部账号7天剩余",
      relayRemaining5h: "全部账号5小时剩余",
      relayPlan: "中转站",
      relaySummary: (known, total) => `已统计 ${known}/${total} 个账号`,
      modeChanged: (mode) => `已切换为${mode}`,
      quotaWindow: "额度窗口",
      sevenDayMode: "7d 模式",
      fiveHourMode: "5h 模式",
      forceRefresh: "强制刷新",
      connect: "连接",
      disconnect: "断开",
      connectedTo: (url) => `已连接 ${url}`,
      disconnected: "尚未连接 Sub2API",
      connecting: "正在连接…",
      twoFactorRequired: "请输入两步验证码后再次连接",
      connectionFailed: "连接失败：",
      backToQuota: "返回额度",
      accountSummary: (count) => `${count} 个账号`,
      accountSummaryWithFailures: (count, failed) => `${count} 个账号 · ${failed} 个读取失败`,
      addAccount: "+ 账号",
      addAccountPrompt: "请输入账号备注名（将绑定当前登录账号）：",
      remove: "删除",
      bindCurrent: "绑定当前账号",
      active: "当前",
      saveReading: "识别并更新",
      resetAll: "全部重置",
      confirmResetAll: "全部账号将恢复为 100%，刷新时间改为 7 天后。",
      cancelResetAll: "取消",
      executeResetAll: "确认重置全部",
      resetAllDone: (count) => `已重置 ${count} 个账号，7 天后刷新`,
      resetAllFailed: "全部重置失败：",
      resetCount: "可重置次数",
      resetAt: "重置",
      lastRefreshed: "刷新",
      nextReset: "下次重置",
      updatedAt: "服务器读取",
      upstreamSampledAt: "上游采样",
      refreshCurrentDone: "当前本机账号额度已刷新",
      refreshAllDone: (count) => `${count} 个账号刷新完成`,
      refreshAllPartial: (ok, failed) => `${ok} 个成功，${failed} 个失败`,
      forceRefreshFailed: "上游额度刷新失败：",
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
      nextPage: "下一页",
      manualQuotaPrompt: "请输入人工矫正额度（0–100）：",
      manualQuotaInvalid: "请输入 0 到 100 之间的数字",
      manualQuotaSaved: "人工额度已保存",
      accountsTab: "账号",
      renewalsTab: "续费提醒",
      renewalBeaconTitle: "续费提醒",
      renewalDaysLeft: (days) => `剩 ${days} 天`,
      renewalDaysToday: "今天到期",
      renewalDaysExpired: (days) => `已过期 ${days} 天`,
      renewalBeaconDays: (days) => `剩 ${days} 天`,
      renewalBeaconToday: "今天",
      renewalBeaconExpired: (days) => `过期 ${days} 天`,
      renewalNoDate: "未设置日期",
      renewalsSummary: (count, attention) => `共 ${count} 项 · 需处理 ${attention} 项`,
      renewalsMonthly: (amount) => `月支出 ¥${amount}`,
      renewalEmpty: "还没有续费提醒，先在下面添加一个",
      renewalQuickAdd: "快速添加",
      renewalNamePlaceholder: "项目名称",
      renewalAmountPlaceholder: "金额（可选）",
      renewalAdd: "保存提醒",
      renewalRenew: (days) => `已续费 +${days} 天`,
      renewalEdit: "编辑",
      renewalEditTitle: "编辑续费提醒",
      renewalEditCycle: "周期天数",
      renewalEditRemind: "提前提醒",
      renewalEditRenewFromToday: "从「今天」起算",
      renewalEditRenewFromOld: "从旧到期日起算",
      renewalEditPayUrl: "付款页链接（可选）",
      renewalEditMuted: "暂停提醒",
      renewalSave: "保存",
      renewalCancel: "取消",
      renewalDelete: "删除",
      renewalOpenPay: "付款页",
      renewalDueDate: (date) => `到期 ${date}`,
      renewalCycleMeta: (days) => `每 ${days} 天`,
      renewalRemindMeta: (days) => `提前 ${days} 天提醒`,
      renewalMutedMeta: "已暂停提醒",
      renewalAdded: (name) => `已添加 ${name} 的续费提醒`,
      renewalSaved: "续费提醒已保存",
      renewalRemoved: "续费提醒已删除",
      renewalRenewed: (name, date) => `${name} 已顺延至 ${date}`,
      renewalRenewedAll: (count) => `${count} 项已顺延`,
      renewalInvalidDate: "请选择有效的到期日期",
      renewalInvalidName: "请填写项目名称",
      renewalSnoozed: "1 小时后再提醒",
      renewalAlertTitle: (count) => `${count} 项需要续费`,
      renewalAlertExpiredTitle: "有订阅已过期",
      renewalAlertSub: "点「已续费」按各自周期顺延",
      renewalAlertRenewAll: "全部已续费",
      renewalAlertOpen: "查看清单",
      renewalAlertSnooze: "稍后 1 小时"
    },
    en: {
      brand: "ChatGPT Quota",
      loading: "Loading",
      remaining7d: "7 days left",
      remaining5h: "5 hours left",
      weekly: "Reset",
      plan: "Plan",
      statusLoading: "Reading ChatGPT quota…",
      statusNoReset: "Waiting for reset time",
      statusReset: (when) => `Resets ${when}`,
      exhausted: "Quota exhausted (0% left)",
      error: "Cannot read quota",
      staleReading: "Update unavailable; keeping the last result",
      errorKinds: {
        sub2api_network: "Cannot reach Sub2API; check Docker",
        sub2api_auth: "Sub2API is not signed in or the session expired",
        sub2api_service: "Sub2API returned an unexpected response",
        sub2api_probe_stale: "The upstream service did not produce a new quota snapshot",
        sub2api_empty: "No OpenAI OAuth accounts in Sub2API",
        network: "Proxy or network connection problem",
        component_missing: "Local Codex component was not found",
        component_start_failed: "Local Codex component failed to start",
        auth: "Codex sign-in is missing or expired",
        service: "Quota service returned an unexpected response",
        unknown: "Unknown quota-reading error"
      },
      planUnknown: "Unknown",
      stateLoading: "Loading",
      stateOk: "Plenty left",
      stateWarn: "Low quota",
      stateError: "Unavailable",
      langToggle: "中文",
      quotaExhaustedShort: "Exhausted",
      accounts: "Accounts",
      accountsShort: "Accounts",
      pinShort: "Pin",
      refreshShort: "Refresh",
      hideShort: "Hide",
      accountsSection: "Profile",
      usageMode: "Usage mode",
      personalMode: "Personal",
      relayMode: "Relay",
      relayRemaining: "All accounts left",
      relayRemaining7d: "All accounts 7d left",
      relayRemaining5h: "All accounts 5h left",
      relayPlan: "Relay",
      relaySummary: (known, total) => `${known}/${total} accounts included`,
      modeChanged: (mode) => `Switched to ${mode}`,
      quotaWindow: "Quota window",
      sevenDayMode: "7d mode",
      fiveHourMode: "5h mode",
      forceRefresh: "Force refresh",
      connect: "Connect",
      disconnect: "Disconnect",
      connectedTo: (url) => `Connected to ${url}`,
      disconnected: "Sub2API is not connected",
      connecting: "Connecting…",
      twoFactorRequired: "Enter the two-factor code and connect again",
      connectionFailed: "Connection failed: ",
      backToQuota: "Back to quota",
      accountSummary: (count) => `${count} account${count === 1 ? "" : "s"}`,
      accountSummaryWithFailures: (count, failed) => `${count} accounts · ${failed} failed`,
      addAccount: "+ Account",
      addAccountPrompt: "Enter a label (binds the currently signed-in account):",
      remove: "Remove",
      bindCurrent: "Bind current",
      active: "Active",
      saveReading: "Detect and update",
      resetAll: "Reset all",
      confirmResetAll: "Every account will be restored to 100% and refresh in 7 days.",
      cancelResetAll: "Cancel",
      executeResetAll: "Confirm reset all",
      resetAllDone: (count) => `Reset ${count} account${count === 1 ? "" : "s"}; refreshes in 7 days`,
      resetAllFailed: "Reset all failed: ",
      resetCount: "Reset count",
      resetAt: "Resets",
      lastRefreshed: "Refreshed",
      nextReset: "Next reset",
      updatedAt: "Server read",
      upstreamSampledAt: "Upstream sampled",
      refreshCurrentDone: "Current local account quota refreshed",
      refreshAllDone: (count) => `${count} accounts refreshed`,
      refreshAllPartial: (ok, failed) => `${ok} succeeded, ${failed} failed`,
      forceRefreshFailed: "Upstream refresh failed: ",
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
      nextPage: "Next",
      manualQuotaPrompt: "Enter a corrected quota (0–100):",
      manualQuotaInvalid: "Enter a number between 0 and 100",
      manualQuotaSaved: "Corrected quota saved",
      accountsTab: "Accounts",
      renewalsTab: "Renewals",
      renewalBeaconTitle: "Renewal reminders",
      renewalDaysLeft: (days) => `${days}d left`,
      renewalDaysToday: "Due today",
      renewalDaysExpired: (days) => `${days}d overdue`,
      renewalBeaconDays: (days) => `${days}d`,
      renewalBeaconToday: "today",
      renewalBeaconExpired: (days) => `-${days}d`,
      renewalNoDate: "No date set",
      renewalsSummary: (count, attention) => `${count} items · ${attention} need action`,
      renewalsMonthly: (amount) => `¥${amount}/mo`,
      renewalEmpty: "No renewal reminders yet — add one below",
      renewalQuickAdd: "Quick add",
      renewalNamePlaceholder: "Item name",
      renewalAmountPlaceholder: "Amount (optional)",
      renewalAdd: "Save reminder",
      renewalRenew: (days) => `Renewed +${days}d`,
      renewalEdit: "Edit",
      renewalEditTitle: "Edit renewal reminder",
      renewalEditCycle: "Cycle days",
      renewalEditRemind: "Remind before",
      renewalEditRenewFromToday: "Count from today",
      renewalEditRenewFromOld: "Stack on old deadline",
      renewalEditPayUrl: "Payment URL (optional)",
      renewalEditMuted: "Pause reminders",
      renewalSave: "Save",
      renewalCancel: "Cancel",
      renewalDelete: "Delete",
      renewalOpenPay: "Pay page",
      renewalDueDate: (date) => `Due ${date}`,
      renewalCycleMeta: (days) => `every ${days}d`,
      renewalRemindMeta: (days) => `remind ${days}d before`,
      renewalMutedMeta: "reminders paused",
      renewalAdded: (name) => `Reminder added for ${name}`,
      renewalSaved: "Reminder saved",
      renewalRemoved: "Reminder deleted",
      renewalRenewed: (name, date) => `${name} extended to ${date}`,
      renewalRenewedAll: (count) => `${count} item(s) extended`,
      renewalInvalidDate: "Pick a valid due date",
      renewalInvalidName: "Enter an item name",
      renewalSnoozed: "Will remind again in 1 hour",
      renewalAlertTitle: (count) => `${count} item(s) need renewal`,
      renewalAlertExpiredTitle: "A subscription has expired",
      renewalAlertSub: "Tap “Renewed” to extend by its cycle",
      renewalAlertRenewAll: "Renew all",
      renewalAlertOpen: "Open list",
      renewalAlertSnooze: "Later (1h)"
    }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    body: document.body,
    brandName: $("brandName"),
    brandState: $("brandState"),
    closeBtn: $("closeBtn"),
    accountsActionLabel: $("accountsActionLabel"),
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
    usageModeLabel: $("usageModeLabel"),
    personalModeBtn: $("personalModeBtn"),
    relayModeBtn: $("relayModeBtn"),
    quotaWindowLabel: $("quotaWindowLabel"),
    sevenDayWindowBtn: $("sevenDayWindowBtn"),
    fiveHourWindowBtn: $("fiveHourWindowBtn"),
    compactSevenDayBtn: $("compactSevenDayBtn"),
    compactFiveHourBtn: $("compactFiveHourBtn"),
    accountsList: $("accountsList"),
    accountsPagination: $("accountsPagination"),
    previousAccountsPageBtn: $("previousAccountsPageBtn"),
    accountsPageText: $("accountsPageText"),
    nextAccountsPageBtn: $("nextAccountsPageBtn"),
    forceRefreshAccountsBtn: $("forceRefreshAccountsBtn"),
    sub2apiConnectionPanel: $("sub2apiConnectionPanel"),
    sub2apiConnectionStatus: $("sub2apiConnectionStatus"),
    sub2apiLoginForm: $("sub2apiLoginForm"),
    sub2apiUrlInput: $("sub2apiUrlInput"),
    sub2apiEmailInput: $("sub2apiEmailInput"),
    sub2apiPasswordInput: $("sub2apiPasswordInput"),
    sub2apiTotpInput: $("sub2apiTotpInput"),
    connectSub2apiBtn: $("connectSub2apiBtn"),
    disconnectSub2apiBtn: $("disconnectSub2apiBtn"),
    renewalBeacon: $("renewalBeacon"),
    renewalBeaconText: $("renewalBeaconText"),
    accountsTabBtn: $("accountsTabBtn"),
    renewalsTabBtn: $("renewalsTabBtn"),
    accountsTabPane: $("accountsTabPane"),
    renewalsTabPane: $("renewalsTabPane"),
    renewalsSummaryText: $("renewalsSummaryText"),
    renewalsMonthlyText: $("renewalsMonthlyText"),
    renewalsList: $("renewalsList"),
    renewalForm: $("renewalForm"),
    renewalFormCaption: $("renewalFormCaption"),
    renewalNameInput: $("renewalNameInput"),
    renewalDateInput: $("renewalDateInput"),
    renewalCycleSelect: $("renewalCycleSelect"),
    renewalAmountInput: $("renewalAmountInput"),
    renewalSaveBtn: $("renewalSaveBtn"),
    renewalEditForm: $("renewalEditForm"),
    renewalEditCaption: $("renewalEditCaption"),
    renewalEditNameInput: $("renewalEditNameInput"),
    renewalEditDateInput: $("renewalEditDateInput"),
    renewalEditCycleLabel: $("renewalEditCycleLabel"),
    renewalEditCycleInput: $("renewalEditCycleInput"),
    renewalEditRemindLabel: $("renewalEditRemindLabel"),
    renewalEditRemindInput: $("renewalEditRemindInput"),
    renewalEditAmountInput: $("renewalEditAmountInput"),
    renewalEditRenewFromSelect: $("renewalEditRenewFromSelect"),
    renewalEditUrlInput: $("renewalEditUrlInput"),
    renewalEditMutedInput: $("renewalEditMutedInput"),
    renewalEditMutedLabel: $("renewalEditMutedLabel"),
    renewalEditSaveBtn: $("renewalEditSaveBtn"),
    renewalEditCancelBtn: $("renewalEditCancelBtn"),
    renewalEditDeleteBtn: $("renewalEditDeleteBtn"),
    renewalAlertSheet: $("renewalAlertSheet"),
    renewalAlertTitle: $("renewalAlertTitle"),
    renewalAlertSub: $("renewalAlertSub"),
    renewalAlertList: $("renewalAlertList"),
    renewalAlertRenewAllBtn: $("renewalAlertRenewAllBtn"),
    renewalAlertOpenBtn: $("renewalAlertOpenBtn"),
    renewalAlertSnoozeBtn: $("renewalAlertSnoozeBtn"),
    toast: $("toast")
  };

  const lang = "zh";
  let fetching = false;
  let lastData = null;
  let resetTimer = null;
  let pollTimer = null;
  let countdownTimer = null;
  let accountsFetching = false;
  let currentView = "led";
  let accountPage = 0;
  let viewTransitioning = false;
  let usageMode = "personal";
  let quotaWindow = "7d";
  let panelTab = "accounts";
  let renewalItems = [];
  let renewalSummary = null;
  let renewalSettings = null;
  let editingRenewalId = null;

  function setState(state) {
    els.body.setAttribute("data-state", state);
  }

  function planName(planType) {
    if (planType === "relay") return STR[lang].relayPlan;
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
      if (days > 0) return `${days}天${hours % 24}小时`;
      if (hours > 0) return `${hours}小时${minutes}分钟`;
      return `${minutes}分钟`;
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
    els.remainingLabel.textContent = quotaWindow === "5h" ? STR[lang].remaining5h : STR[lang].remaining7d;
    els.secondaryLabel.textContent = STR[lang].weekly;
    els.planLabel.textContent = STR[lang].plan;
    els.accountsTitle.textContent = STR[lang].accountsSection;
    els.usageModeLabel.textContent = STR[lang].usageMode;
    els.personalModeBtn.textContent = STR[lang].personalMode;
    els.relayModeBtn.textContent = STR[lang].relayMode;
    els.quotaWindowLabel.textContent = STR[lang].quotaWindow;
    els.sevenDayWindowBtn.textContent = STR[lang].sevenDayMode;
    els.fiveHourWindowBtn.textContent = STR[lang].fiveHourMode;
    els.forceRefreshAccountsBtn.textContent = STR[lang].forceRefresh;
    els.connectSub2apiBtn.textContent = STR[lang].connect;
    els.disconnectSub2apiBtn.textContent = STR[lang].disconnect;
    els.previousAccountsPageBtn.textContent = STR[lang].previousPage;
    els.nextAccountsPageBtn.textContent = STR[lang].nextPage;
    els.accountsActionLabel.textContent = STR[lang].accountsShort;
    // renewal reminders
    els.renewalBeacon.title = STR[lang].renewalBeaconTitle;
    els.renewalBeacon.setAttribute("aria-label", STR[lang].renewalBeaconTitle);
    els.accountsTabBtn.textContent = STR[lang].accountsTab;
    els.renewalFormCaption.textContent = STR[lang].renewalQuickAdd;
    els.renewalNameInput.placeholder = STR[lang].renewalNamePlaceholder;
    els.renewalAmountInput.placeholder = STR[lang].renewalAmountPlaceholder;
    els.renewalSaveBtn.textContent = STR[lang].renewalAdd;
    for (const option of Array.from(els.renewalCycleSelect.options)) {
      option.textContent = STR[lang].renewalCycleMeta(Number(option.value));
    }
    els.renewalEditCaption.textContent = STR[lang].renewalEditTitle;
    els.renewalEditNameInput.placeholder = STR[lang].renewalNamePlaceholder;
    els.renewalEditAmountInput.placeholder = STR[lang].renewalAmountPlaceholder;
    els.renewalEditCycleLabel.textContent = STR[lang].renewalEditCycle;
    els.renewalEditRemindLabel.textContent = STR[lang].renewalEditRemind;
    els.renewalEditUrlInput.placeholder = STR[lang].renewalEditPayUrl;
    els.renewalEditMutedLabel.textContent = STR[lang].renewalEditMuted;
    els.renewalEditSaveBtn.textContent = STR[lang].renewalSave;
    els.renewalEditCancelBtn.textContent = STR[lang].renewalCancel;
    els.renewalEditDeleteBtn.textContent = STR[lang].renewalDelete;
    for (const option of Array.from(els.renewalEditRenewFromSelect.options)) {
      option.textContent = option.value === "oldDeadline"
        ? STR[lang].renewalEditRenewFromOld
        : STR[lang].renewalEditRenewFromToday;
    }
    els.renewalAlertRenewAllBtn.textContent = STR[lang].renewalAlertRenewAll;
    els.renewalAlertOpenBtn.textContent = STR[lang].renewalAlertOpen;
    els.renewalAlertSnoozeBtn.textContent = STR[lang].renewalAlertSnooze;
    renderRenewalTabLabel();
    syncViewLabels();
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }

  function syncViewLabels() {
    const label = currentView === "accounts" ? STR[lang].backToQuota : STR[lang].accounts;
    els.accountsBtn.title = label;
    els.accountsBtn.setAttribute("aria-label", label);
  }

  function renderQuota(data) {
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
    lastData = data;

    const capacity = data.mode === "relay" ? Math.max(100, Number(data.capacityPercent) || 100) : 100;
    const displayLevel = Math.max(0, Math.min(100, (remaining / capacity) * 100));
    const state = stateFor(displayLevel);
    setState(state);
    els.liquidFill.style.setProperty("--level", displayLevel + "%");
    els.remaining.textContent = remaining + "%";

    if (data.mode === "relay") {
      els.remainingLabel.textContent = data.quotaWindow === "5h"
        ? STR[lang].relayRemaining5h
        : STR[lang].relayRemaining7d;
      els.secondaryText.textContent = STR[lang].relaySummary(
        data.knownAccountCount || 0,
        data.accountCount || 0
      );
      els.statusText.textContent = STR[lang].relaySummary(
        data.knownAccountCount || 0,
        data.accountCount || 0
      );
      els.planText.textContent = planName(data.planType);
      els.brandState.textContent = STR[lang].relayMode;
      scheduleRefresh(null);
      return;
    }
    els.remainingLabel.textContent = data.quotaWindow === "5h"
      ? STR[lang].remaining5h
      : STR[lang].remaining7d;

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
    const sampledAt = formatReset(data.upstreamSampledAt);
    if (sampledAt) {
      els.statusText.textContent += ` · ${STR[lang].upstreamSampledAt} ${sampledAt}`;
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

  function quotaErrorKind(error) {
    const raw = String(error?.message || error || "");
    const match = raw.match(/QUOTA_DIAGNOSTIC\|([a-z_]+)/);
    return match ? match[1] : "unknown";
  }

  function renderError(error) {
    const kind = quotaErrorKind(error);
    const reason = STR[lang].errorKinds[kind] || STR[lang].errorKinds.unknown;
    if (lastData) {
      renderQuota(lastData);
      els.statusText.textContent = `${reason} · ${STR[lang].staleReading}`;
      els.brandState.textContent = reason;
      return;
    }
    setState("error");
    els.liquidFill.style.setProperty("--level", "0%");
    els.remaining.textContent = "--%";
    els.secondaryText.textContent = STR[lang].error;
    els.planText.textContent = STR[lang].planUnknown;
    els.statusText.textContent = `${STR[lang].error}：${reason}`;
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

  async function refresh(options = {}) {
    if (fetching) return;
    fetching = true;
    setState("loading");
    els.brandState.textContent = STR[lang].stateLoading;
    els.statusText.textContent = STR[lang].statusLoading;
    try {
      const data = await window.chatgptQuota.getQuota({ force: Boolean(options.force) });
      renderQuota(data);
      if (options.force) showToast(STR[lang].refreshCurrentDone);
    } catch (err) {
      renderError(err);
      if (options.force) {
        const reason = STR[lang].errorKinds[quotaErrorKind(err)] || err?.message || STR[lang].error;
        showToast(STR[lang].forceRefreshFailed + reason);
      }
    } finally {
      fetching = false;
    }
  }

  function syncUsageModeControls() {
    const isRelay = usageMode === "relay";
    els.personalModeBtn.classList.toggle("active", !isRelay);
    els.relayModeBtn.classList.toggle("active", isRelay);
    els.personalModeBtn.setAttribute("aria-checked", String(!isRelay));
    els.relayModeBtn.setAttribute("aria-checked", String(isRelay));
  }

  function syncQuotaWindowControls() {
    const isFiveHour = quotaWindow === "5h";
    els.sevenDayWindowBtn.classList.toggle("active", !isFiveHour);
    els.fiveHourWindowBtn.classList.toggle("active", isFiveHour);
    els.compactSevenDayBtn.classList.toggle("active", !isFiveHour);
    els.compactFiveHourBtn.classList.toggle("active", isFiveHour);
    els.sevenDayWindowBtn.setAttribute("aria-checked", String(!isFiveHour));
    els.fiveHourWindowBtn.setAttribute("aria-checked", String(isFiveHour));
    els.compactSevenDayBtn.setAttribute("aria-checked", String(!isFiveHour));
    els.compactFiveHourBtn.setAttribute("aria-checked", String(isFiveHour));
  }

  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const interval = usageMode === "relay" ? RELAY_REFRESH_INTERVAL_MS : PERSONAL_REFRESH_INTERVAL_MS;
    pollTimer = setInterval(() => refresh(), interval);
  }

  async function changeUsageMode(mode) {
    if (mode === usageMode) return;
    usageMode = await window.chatgptQuota.setUsageMode(mode);
    lastData = null;
    syncUsageModeControls();
    restartPolling();
    await refresh();
    if (usageMode === "relay") window.chatgptQuota.openRelay().catch(() => {});
    showToast(STR[lang].modeChanged(
      usageMode === "relay" ? STR[lang].relayMode : STR[lang].personalMode
    ));
  }

  async function changeQuotaWindow(nextWindow) {
    if (nextWindow === quotaWindow) return;
    quotaWindow = await window.chatgptQuota.setQuotaWindow(nextWindow);
    lastData = null;
    syncQuotaWindowControls();
    await refresh();
    if (currentView === "accounts") await renderAccounts();
    showToast(STR[lang].modeChanged(
      quotaWindow === "5h" ? STR[lang].fiveHourMode : STR[lang].sevenDayMode
    ));
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function setView(view) {
    if (viewTransitioning || view === currentView) return;
    viewTransitioning = true;
    try {
      if (view === "accounts") {
        currentView = view;
        document.body.dataset.view = view;
        syncViewLabels();
        els.accountsPanel.hidden = false;
        accountPage = 0;
        els.brandName.textContent = STR[lang].accounts;
        els.brandState.textContent = "";
        await window.chatgptQuota.setView({ view: "accounts" });
        await renderAccounts();
      } else {
        document.body.classList.add("drawer-closing");
        await window.chatgptQuota.setView("led");
        currentView = view;
        document.body.dataset.view = view;
        els.accountsPanel.hidden = true;
        hideRenewalAlert();
        syncViewLabels();
        if (lastData) renderQuota(lastData);
        else applyStaticText();
      }
    } finally {
      document.body.classList.remove("drawer-closing");
      viewTransitioning = false;
    }
  }

  async function syncConnectionUi() {
    const connection = await window.chatgptQuota.getSub2apiConnection();
    els.sub2apiUrlInput.value = connection.baseUrl || "http://127.0.0.1:18080";
    els.sub2apiConnectionStatus.textContent = connection.connected
      ? STR[lang].connectedTo(connection.baseUrl)
      : STR[lang].disconnected;
    els.sub2apiLoginForm.hidden = connection.connected;
    els.disconnectSub2apiBtn.hidden = !connection.connected;
    els.forceRefreshAccountsBtn.disabled = !connection.connected;
    return connection;
  }

  async function renderAccounts(options = {}) {
    if (accountsFetching) return null;
    accountsFetching = true;
    try {
      const connection = await syncConnectionUi();
      if (!connection.connected) {
        els.accountsList.innerHTML = "";
        els.accountsPagination.hidden = true;
        els.brandName.textContent = STR[lang].accounts;
        els.brandState.textContent = STR[lang].disconnected;
        resizeAccountsView();
        return null;
      }
      const result = options.result || await window.chatgptQuota.getAccounts({
        force: Boolean(options.force),
        refresh: Boolean(options.refresh || options.force)
      });
      const accounts = Array.isArray(result) ? result : result?.accounts || [];
      const failures = Array.isArray(result?.failures) ? result.failures : [];
      els.brandName.textContent = STR[lang].accounts;
      els.brandState.textContent = failures.length > 0
        ? STR[lang].accountSummaryWithFailures(accounts.length, failures.length)
        : STR[lang].accountSummary(accounts.length);
      const sortedAccounts = accounts.slice();
      const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / ACCOUNTS_PER_PAGE));
      accountPage = Math.max(0, Math.min(accountPage, totalPages - 1));
      const pageAccounts = sortedAccounts.slice(
        accountPage * ACCOUNTS_PER_PAGE,
        (accountPage + 1) * ACCOUNTS_PER_PAGE
      );
      els.accountsList.innerHTML = "";
      for (const acc of pageAccounts) {
        const row = document.createElement("div");
        const selectedWindow = quotaWindow === "5h" ? acc.fiveHour : acc.sevenDay;
        const remainingPercent = selectedWindow?.remainingPercent ?? null;
        const resetsAt = selectedWindow?.resetsAt ?? null;
        const isExhausted = remainingPercent === 0;
        row.className =
          "account-row" +
          (isExhausted ? " exhausted" : "") +
          (acc.stale || acc.errorCode ? " stale" : "");
        row.dataset.id = acc.id;
        const countdown = formatResetCountdown(resetsAt);
        const urgency = countdownUrgency(resetsAt);
        row.innerHTML =
          '<div class="account-head">' +
          '<div class="account-identity"><span class="account-label">' + escapeHtml(acc.label) + "</span>" +
          '</div><strong class="account-quota">' +
          (remainingPercent == null ? STR[lang].remainingUnknown : remainingPercent + "%") +
          "</strong></div>" +
          '<div class="account-reset"><span class="account-detail-label">' + STR[lang].nextReset +
          '</span><strong class="reset-date-value">' + (formatReset(resetsAt) || "--") + "</strong>" +
          (countdown ? '<span class="reset-countdown ' + urgency + '">' + countdown + "</span>" : "") +
          "</div>" +
          '<div class="account-footer"><span class="refreshed-date">' + STR[lang].updatedAt + " " +
          (formatReset(acc.serverReadAt) || "--") + " · " + STR[lang].upstreamSampledAt + " " +
          (formatReset(acc.upstreamSampledAt) || "--") + "</span></div>";
        els.accountsList.appendChild(row);
      }

      els.accountsPagination.hidden = totalPages <= 1;
      els.accountsPageText.textContent = `${accountPage + 1} / ${totalPages}`;
      els.previousAccountsPageBtn.disabled = accountPage === 0;
      els.nextAccountsPageBtn.disabled = accountPage >= totalPages - 1;
      resizeAccountsView();
      return { accounts, failures };
    } catch (error) {
      els.brandState.textContent = STR[lang].errorKinds[quotaErrorKind(error)] || STR[lang].error;
      showToast(error?.message || STR[lang].error);
      resizeAccountsView();
      return null;
    } finally {
      accountsFetching = false;
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

  async function connectSub2api() {
    els.connectSub2apiBtn.disabled = true;
    els.sub2apiConnectionStatus.textContent = STR[lang].connecting;
    try {
      const result = await window.chatgptQuota.connectSub2api({
        baseUrl: els.sub2apiUrlInput.value,
        email: els.sub2apiEmailInput.value,
        password: els.sub2apiPasswordInput.value,
        totpCode: els.sub2apiTotpInput.value
      });
      if (result?.requires2fa) {
        els.sub2apiTotpInput.hidden = false;
        els.sub2apiTotpInput.focus();
        els.sub2apiConnectionStatus.textContent = STR[lang].twoFactorRequired;
        return;
      }
      els.sub2apiPasswordInput.value = "";
      els.sub2apiTotpInput.value = "";
      els.sub2apiTotpInput.hidden = true;
      await renderAccounts();
    } catch (error) {
      els.sub2apiConnectionStatus.textContent = STR[lang].disconnected;
      showToast(STR[lang].connectionFailed + (error?.message || ""));
    } finally {
      els.connectSub2apiBtn.disabled = false;
      resizeAccountsView();
    }
  }

  async function disconnectSub2api() {
    els.disconnectSub2apiBtn.disabled = true;
    try {
      await window.chatgptQuota.disconnectSub2api();
      await renderAccounts();
    } finally {
      els.disconnectSub2apiBtn.disabled = false;
    }
  }

  /* ---------------- renewal reminders (manual top-ups) ---------------- */

  function formatDateOnly(value) {
    const ms = value instanceof Date ? value.getTime() : Date.parse(value || "");
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function renewalDaysLabel(item) {
    if (item.daysLeft == null) return STR[lang].renewalNoDate;
    if (item.daysLeft === 0) return STR[lang].renewalDaysToday;
    if (item.daysLeft < 0) return STR[lang].renewalDaysExpired(-item.daysLeft);
    return STR[lang].renewalDaysLeft(item.daysLeft);
  }

  function renewalProgress(item) {
    if (item.daysLeft == null) return 3;
    const cycle = Math.max(1, Number(item.cycleDays) || 30);
    const pct = 100 - (Math.max(0, item.daysLeft) / cycle) * 100;
    return Math.max(3, Math.min(100, Math.round(pct)));
  }

  function renderRenewalTabLabel() {
    const attention = renewalSummary ? renewalSummary.attentionCount : 0;
    els.renewalsTabBtn.innerHTML =
      escapeHtml(STR[lang].renewalsTab) +
      (attention > 0 ? `<span class="tab-badge">${attention}</span>` : "");
    els.renewalsTabBtn.classList.toggle("active", panelTab === "renewals");
    els.renewalsTabBtn.setAttribute("aria-selected", String(panelTab === "renewals"));
    els.accountsTabBtn.classList.toggle("active", panelTab === "accounts");
    els.accountsTabBtn.setAttribute("aria-selected", String(panelTab === "accounts"));
  }

  function renderRenewalBeacon() {
    const summary = renewalSummary;
    if (!summary || summary.count === 0) {
      els.renewalBeacon.hidden = true;
      els.body.removeAttribute("data-alert");
      return;
    }
    const attention = summary.items.filter((item) => item.status !== "ok" && !item.muted);
    const focus = attention.length > 0 ? attention[0] : summary.items[0];
    els.renewalBeacon.hidden = false;
    els.renewalBeacon.classList.toggle("due", summary.level === "due");
    els.renewalBeacon.classList.toggle("expired", summary.level === "expired");
    els.renewalBeaconText.textContent =
      focus.daysLeft == null
        ? STR[lang].renewalNoDate
        : focus.daysLeft === 0
          ? STR[lang].renewalBeaconToday
          : focus.daysLeft < 0
            ? STR[lang].renewalBeaconExpired(-focus.daysLeft)
            : STR[lang].renewalBeaconDays(focus.daysLeft);
    if (summary.level === "none") els.body.removeAttribute("data-alert");
    else els.body.setAttribute("data-alert", summary.level);
  }

  function renewalCardHtml(item, compact) {
    const statusClass = item.status === "ok" ? "" : ` ${item.status}`;
    const meta = [
      item.renewsAt ? STR[lang].renewalDueDate(formatDateOnly(item.renewsAt)) : STR[lang].renewalNoDate,
      item.amount != null ? `¥${item.amount}` : null,
      STR[lang].renewalCycleMeta(item.cycleDays),
      compact ? null : STR[lang].renewalRemindMeta(item.remindBeforeDays),
      item.muted ? STR[lang].renewalMutedMeta : null
    ].filter(Boolean);
    return (
      `<div class="renewal-card${statusClass}${item.muted ? " muted" : ""}" data-id="${escapeHtml(item.id)}">` +
      `<div class="renewal-head"><span class="renewal-name">${escapeHtml(item.name)}</span>` +
      `<span class="renewal-pill ${item.status === "ok" ? "ok" : "bad"}">${escapeHtml(renewalDaysLabel(item))}</span></div>` +
      `<div class="renewal-bar"><i style="width:${renewalProgress(item)}%"></i></div>` +
      `<div class="renewal-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>` +
      (compact
        ? ""
        : `<div class="renewal-actions">` +
          `<button class="text-button solid-danger" data-act="renew">${escapeHtml(STR[lang].renewalRenew(item.cycleDays))}</button>` +
          (item.payUrl ? `<button class="text-button" data-act="pay">${escapeHtml(STR[lang].renewalOpenPay)}</button>` : "") +
          `<button class="text-button push" data-act="edit">${escapeHtml(STR[lang].renewalEdit)}</button>` +
          `</div>`) +
      `</div>`
    );
  }

  function renderRenewals() {
    renderRenewalTabLabel();
    renderRenewalBeacon();
    if (!renewalSummary) return;
    els.renewalsSummaryText.textContent = STR[lang].renewalsSummary(
      renewalSummary.count,
      renewalSummary.attentionCount
    );
    els.renewalsMonthlyText.textContent = STR[lang].renewalsMonthly(renewalSummary.monthlyTotal);
    const visible = renewalItems.filter((item) => !item.archived);
    els.renewalsList.innerHTML = visible.length === 0
      ? `<div class="renewals-empty">${escapeHtml(STR[lang].renewalEmpty)}</div>`
      : visible.map((item) => renewalCardHtml(item, false)).join("");
    resizeAccountsView();
  }

  async function refreshRenewals() {
    try {
      const [items, summary, settings] = await Promise.all([
        window.chatgptQuota.listSubscriptions(),
        window.chatgptQuota.getSubscriptionSummary(),
        window.chatgptQuota.getSubscriptionSettings()
      ]);
      renewalItems = Array.isArray(items) ? items : [];
      renewalSummary = summary || null;
      renewalSettings = settings || null;
      renderRenewals();
    } catch (_) {
      // Reminders are auxiliary; never let them break the quota view.
    }
  }

  function setPanelTab(tab) {
    panelTab = tab === "renewals" ? "renewals" : "accounts";
    els.accountsTabPane.hidden = panelTab !== "accounts";
    els.renewalsTabPane.hidden = panelTab !== "renewals";
    if (panelTab === "renewals") renderRenewals();
    else renderRenewalTabLabel();
    resizeAccountsView();
  }

  function openRenewalEdit(id) {
    const item = renewalItems.find((entry) => entry.id === id);
    if (!item) return;
    editingRenewalId = id;
    els.renewalEditNameInput.value = item.name;
    els.renewalEditDateInput.value = formatDateOnly(item.renewsAt);
    els.renewalEditCycleInput.value = String(item.cycleDays);
    els.renewalEditRemindInput.value = String(item.remindBeforeDays);
    els.renewalEditAmountInput.value = item.amount == null ? "" : String(item.amount);
    els.renewalEditRenewFromSelect.value = item.renewFrom;
    els.renewalEditUrlInput.value = item.payUrl || "";
    els.renewalEditMutedInput.checked = Boolean(item.muted);
    els.renewalEditForm.hidden = false;
    els.renewalForm.hidden = true;
    resizeAccountsView();
  }

  function closeRenewalEdit() {
    editingRenewalId = null;
    els.renewalEditForm.hidden = true;
    els.renewalForm.hidden = false;
    resizeAccountsView();
  }

  async function saveRenewalEdit() {
    if (!editingRenewalId) return;
    const date = els.renewalEditDateInput.value;
    if (!date) {
      showToast(STR[lang].renewalInvalidDate);
      return;
    }
    const name = els.renewalEditNameInput.value.trim();
    if (!name) {
      showToast(STR[lang].renewalInvalidName);
      return;
    }
    try {
      await window.chatgptQuota.updateSubscription(editingRenewalId, {
        name,
        renewsAt: date,
        cycleDays: Number(els.renewalEditCycleInput.value),
        remindBeforeDays: Number(els.renewalEditRemindInput.value),
        amount: els.renewalEditAmountInput.value === "" ? null : Number(els.renewalEditAmountInput.value),
        renewFrom: els.renewalEditRenewFromSelect.value,
        payUrl: els.renewalEditUrlInput.value,
        muted: els.renewalEditMutedInput.checked
      });
      showToast(STR[lang].renewalSaved);
      closeRenewalEdit();
      await refreshRenewals();
    } catch (error) {
      showToast(error?.message || STR[lang].renewalSaved);
    }
  }

  async function addRenewal() {
    const name = els.renewalNameInput.value.trim();
    if (!name) {
      showToast(STR[lang].renewalInvalidName);
      return;
    }
    const date = els.renewalDateInput.value;
    if (!date) {
      showToast(STR[lang].renewalInvalidDate);
      return;
    }
    try {
      await window.chatgptQuota.addSubscription({
        name,
        renewsAt: date,
        cycleDays: Number(els.renewalCycleSelect.value),
        amount: els.renewalAmountInput.value === "" ? null : Number(els.renewalAmountInput.value)
      });
      els.renewalNameInput.value = "";
      els.renewalAmountInput.value = "";
      showToast(STR[lang].renewalAdded(name));
      await refreshRenewals();
    } catch (error) {
      showToast(error?.message || STR[lang].renewalInvalidDate);
    }
  }

  async function renewOne(id) {
    try {
      const updated = await window.chatgptQuota.renewSubscription(id);
      showToast(STR[lang].renewalRenewed(updated.name, formatDateOnly(updated.renewsAt)));
      hideRenewalAlert();
      await refreshRenewals();
    } catch (error) {
      showToast(error?.message || "");
    }
  }

  async function renewAllAttention() {
    try {
      const renewed = await window.chatgptQuota.renewAllDue();
      showToast(STR[lang].renewalRenewedAll(renewed.length));
      hideRenewalAlert();
      await refreshRenewals();
    } catch (error) {
      showToast(error?.message || "");
    }
  }

  function hideRenewalAlert() {
    els.renewalAlertSheet.hidden = true;
  }

  function showRenewalAlert(payload) {
    const alerts = (payload && payload.alerts) || [];
    if (alerts.length === 0) return;
    renewalItems = alerts.map((item) => item).concat(
      renewalItems.filter((existing) => !alerts.some((alert) => alert.id === existing.id))
    );
    if (payload && payload.summary) renewalSummary = payload.summary;
    renderRenewals();
    els.renewalAlertTitle.textContent = payload.level === "expired"
      ? STR[lang].renewalAlertExpiredTitle
      : STR[lang].renewalAlertTitle(alerts.length);
    els.renewalAlertSub.textContent = STR[lang].renewalAlertSub;
    els.renewalAlertList.innerHTML = alerts.map((item) => renewalCardHtml(item, true)).join("");
    els.renewalAlertSheet.hidden = false;
    const wantsSheet = !renewalSettings || renewalSettings.channels.sheet !== false;
    if (wantsSheet && document.visibilityState === "visible" && currentView === "led") {
      setView("accounts").then(() => setPanelTab("renewals"));
    }
  }

  function wireControls() {
    els.closeBtn.addEventListener("click", () => window.chatgptQuota.close());

    els.accountsBtn.addEventListener("click", () =>
      setView(currentView === "led" ? "accounts" : "led")
    );
    els.previousAccountsPageBtn.addEventListener("click", () => {
      if (accountPage <= 0) return;
      accountPage -= 1;
      renderAccounts();
    });
    els.nextAccountsPageBtn.addEventListener("click", () => {
      accountPage += 1;
      renderAccounts();
    });
    els.connectSub2apiBtn.addEventListener("click", connectSub2api);
    els.disconnectSub2apiBtn.addEventListener("click", disconnectSub2api);
    els.personalModeBtn.addEventListener("click", () => changeUsageMode("personal"));
    els.relayModeBtn.addEventListener("click", () => changeUsageMode("relay"));
    els.sevenDayWindowBtn.addEventListener("click", () => changeQuotaWindow("7d"));
    els.fiveHourWindowBtn.addEventListener("click", () => changeQuotaWindow("5h"));
    els.compactSevenDayBtn.addEventListener("click", () => changeQuotaWindow("7d"));
    els.compactFiveHourBtn.addEventListener("click", () => changeQuotaWindow("5h"));
    els.forceRefreshAccountsBtn.addEventListener("click", async () => {
      els.forceRefreshAccountsBtn.disabled = true;
      try {
        const result = await renderAccounts({ force: true });
        if (result) {
          const failed = result.failures.length;
          const succeeded = Math.max(0, result.accounts.length - failed);
          showToast(
            failed > 0
              ? STR[lang].refreshAllPartial(succeeded, failed)
              : STR[lang].refreshAllDone(succeeded)
          );
        }
      } finally {
        els.forceRefreshAccountsBtn.disabled = false;
      }
    });
    [els.sub2apiPasswordInput, els.sub2apiTotpInput].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") connectSub2api();
      });
    });
    if (window.chatgptQuota.onAccountsUpdated) {
      window.chatgptQuota.onAccountsUpdated((result) => {
        if (currentView === "accounts") renderAccounts({ result });
        if (usageMode === "relay") refresh();
      });
    }

    /* ---- renewal reminders ---- */

    els.renewalBeacon.addEventListener("click", () => {
      hideRenewalAlert();
      if (currentView !== "accounts") {
        setView("accounts").then(() => setPanelTab("renewals"));
      } else {
        setPanelTab("renewals");
      }
    });
    els.accountsTabBtn.addEventListener("click", () => setPanelTab("accounts"));
    els.renewalsTabBtn.addEventListener("click", () => setPanelTab("renewals"));

    els.renewalSaveBtn.addEventListener("click", addRenewal);
    [els.renewalNameInput, els.renewalDateInput, els.renewalAmountInput].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") addRenewal();
      });
    });

    els.renewalEditSaveBtn.addEventListener("click", saveRenewalEdit);
    els.renewalEditCancelBtn.addEventListener("click", closeRenewalEdit);
    els.renewalEditDeleteBtn.addEventListener("click", async () => {
      if (!editingRenewalId) return;
      if (!window.confirm(STR[lang].confirmRemove)) return;
      try {
        await window.chatgptQuota.removeSubscription(editingRenewalId);
        showToast(STR[lang].renewalRemoved);
        closeRenewalEdit();
        await refreshRenewals();
      } catch (error) {
        showToast(error?.message || "");
      }
    });

    els.renewalsList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");
      if (!button) return;
      const card = button.closest(".renewal-card");
      const item = card && renewalItems.find((entry) => entry.id === card.dataset.id);
      if (!item) return;
      const action = button.dataset.act;
      if (action === "renew") renewOne(item.id);
      else if (action === "edit") openRenewalEdit(item.id);
      else if (action === "pay" && item.payUrl) window.chatgptQuota.openUrl(item.payUrl);
    });

    els.renewalAlertRenewAllBtn.addEventListener("click", renewAllAttention);
    els.renewalAlertOpenBtn.addEventListener("click", () => {
      hideRenewalAlert();
      if (currentView !== "accounts") {
        setView("accounts").then(() => setPanelTab("renewals"));
      } else {
        setPanelTab("renewals");
      }
    });
    els.renewalAlertSnoozeBtn.addEventListener("click", async () => {
      try {
        await window.chatgptQuota.snoozeSubscriptions(null, 60 * 60 * 1000);
      } catch (_) {
        // snooze is best-effort; still dismiss the sheet
      }
      hideRenewalAlert();
      showToast(STR[lang].renewalSnoozed);
      await refreshRenewals();
    });
    els.renewalAlertList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-act]");
      if (!button) return;
      const card = button.closest(".renewal-card");
      const item = card && renewalItems.find((entry) => entry.id === card.dataset.id);
      if (!item) return;
      if (button.dataset.act === "renew") renewOne(item.id);
    });

    if (window.chatgptQuota.onSubscriptionsUpdated) {
      window.chatgptQuota.onSubscriptionsUpdated(async () => {
        await refreshRenewals();
      });
    }
    if (window.chatgptQuota.onSubscriptionAlert) {
      window.chatgptQuota.onSubscriptionAlert((payload) => showRenewalAlert(payload));
    }
  }

  async function start() {
    document.body.dataset.view = "led";
    [usageMode, quotaWindow] = await Promise.all([
      window.chatgptQuota.getUsageMode(),
      window.chatgptQuota.getQuotaWindow()
    ]);
    applyStaticText();
    syncUsageModeControls();
    syncQuotaWindowControls();
    wireControls();
    refresh();
    refreshRenewals();
    restartPolling();
    countdownTimer = setInterval(() => {
      if (lastData) renderQuota(lastData);
      refreshRenewals();
    }, 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
