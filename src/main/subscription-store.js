/**
 * Manual renewal reminders ("paid items I top up by hand").
 *
 * Kept in its own JSON file next to store.json on purpose: store.js only
 * re-reads the fields it knows about, so anything new stored there would be
 * silently dropped on the next legacy merge. This module is dependency-free
 * and injectable (filePath + clock) so it can be unit tested without Electron.
 */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 20;

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultRemindBeforeDays: 3,
  defaultCycleDays: 30,
  channels: { rail: true, sheet: true, balloon: true }
};

const ITEM_DEFAULTS = {
  cycleDays: 30,
  remindBeforeDays: 3,
  amount: null,
  currency: "CNY",
  payUrl: "",
  renewFrom: "today",
  muted: false,
  archived: false,
  snoozedUntil: null,
  lastAlertAt: null
};

/* ---------------- date helpers ---------------- */

/**
 * Accepts ISO strings, "YYYY-MM-DD" and "YYYY-MM-DD HH:mm".
 * A bare date means "expires during that day", i.e. local 23:59:59, so the
 * due day itself still counts as 1 day left instead of already expired.
 */
function parseDeadline(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const text = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const date = new Date(y, m - 1, d, 23, 59, 59, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Calendar-day difference, not a 24h ceiling: a deadline on 10-09 seen from
 * 10-06 is "3 days left", on 10-09 it is "due today" (0), and from 10-10 on
 * it counts as expired. That matches how people read a billing date.
 */
function daysLeftOf(deadlineMs, nowMs) {
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.round((startOfDay(deadlineMs) - startOfDay(nowMs)) / DAY_MS);
}

function statusOf(item, nowMs) {
  const deadline = parseDeadline(item.renewsAt);
  if (!Number.isFinite(deadline)) return "ok";
  const days = daysLeftOf(deadline, nowMs);
  if (days < 0) return "expired";
  const remind = Math.max(0, Number(item.remindBeforeDays) || 0);
  return days <= remind ? "due" : "ok";
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ---------------- store factory ---------------- */

function createSubscriptionStore({ filePath, now = () => Date.now() } = {}) {
  let state = null;

  function defaults() {
    return {
      version: 1,
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      items: []
    };
  }

  function load() {
    if (!filePath) return defaults();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const base = defaults();
      return {
        version: 1,
        settings: {
          ...base.settings,
          ...(parsed && typeof parsed.settings === "object" ? parsed.settings : {}),
          channels: {
            ...base.settings.channels,
            ...((parsed && parsed.settings && parsed.settings.channels) || {})
          }
        },
        items: Array.isArray(parsed && parsed.items) ? parsed.items.map(normalizeItem) : []
      };
    } catch {
      return defaults();
    }
  }

  function getState() {
    if (!state) state = load();
    return state;
  }

  function save() {
    if (!filePath) return;
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(getState(), null, 2));
    fs.renameSync(tmp, filePath);
  }

  function normalizeItem(raw) {
    const item = { ...ITEM_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
    item.id = typeof item.id === "string" && item.id ? item.id : randomUUID();
    item.name = String(item.name || "").trim() || "未命名订阅";
    item.cycleDays = clampInt(item.cycleDays, 1, 3650, ITEM_DEFAULTS.cycleDays);
    item.remindBeforeDays = clampInt(item.remindBeforeDays, 0, 60, ITEM_DEFAULTS.remindBeforeDays);
    item.renewFrom = item.renewFrom === "oldDeadline" ? "oldDeadline" : "today";
    item.amount = Number.isFinite(Number(item.amount)) && item.amount !== null && item.amount !== ""
      ? Number(item.amount)
      : null;
    item.history = Array.isArray(item.history) ? item.history.slice(0, HISTORY_LIMIT) : [];
    return item;
  }

  function toPublic(item, nowMs = now()) {
    const deadline = parseDeadline(item.renewsAt);
    return {
      ...item,
      deadlineMs: deadline,
      daysLeft: daysLeftOf(deadline, nowMs),
      status: statusOf(item, nowMs)
    };
  }

  function clearAlertState(item) {
    item.snoozedUntil = null;
    item.lastAlertAt = null;
  }

  function pushHistory(item, entry) {
    item.history = [{ ...entry, at: new Date(now()).toISOString() }, ...(item.history || [])].slice(
      0,
      HISTORY_LIMIT
    );
  }

  /* ---------------- reads ---------------- */

  function getSettings() {
    return JSON.parse(JSON.stringify(getState().settings));
  }

  function setSettings(patch) {
    const settings = getState().settings;
    if (patch && typeof patch === "object") {
      if (typeof patch.enabled === "boolean") settings.enabled = patch.enabled;
      if (typeof patch.defaultRemindBeforeDays !== "undefined") {
        settings.defaultRemindBeforeDays = clampInt(patch.defaultRemindBeforeDays, 0, 60, settings.defaultRemindBeforeDays);
      }
      if (typeof patch.defaultCycleDays !== "undefined") {
        settings.defaultCycleDays = clampInt(patch.defaultCycleDays, 1, 3650, settings.defaultCycleDays);
      }
      if (patch.channels && typeof patch.channels === "object") {
        for (const key of ["rail", "sheet", "balloon"]) {
          if (typeof patch.channels[key] === "boolean") settings.channels[key] = patch.channels[key];
        }
      }
    }
    save();
    return getSettings();
  }

  function list() {
    const nowMs = now();
    return getState()
      .items.map((item) => toPublic(item, nowMs))
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        const da = Number.isFinite(a.deadlineMs) ? a.deadlineMs : Number.POSITIVE_INFINITY;
        const db = Number.isFinite(b.deadlineMs) ? b.deadlineMs : Number.POSITIVE_INFINITY;
        return da - db;
      });
  }

  function activeItems() {
    return getState().items.filter((item) => !item.archived);
  }

  function summary() {
    const nowMs = now();
    const items = activeItems().map((item) => toPublic(item, nowMs));
    const due = items.filter((item) => item.status === "due");
    const expired = items.filter((item) => item.status === "expired");
    const monthlyTotal = items.reduce((total, item) => {
      if (item.amount == null) return total;
      const cycle = Math.max(1, item.cycleDays);
      return total + (item.amount * 30) / cycle;
    }, 0);
    return {
      count: items.length,
      dueCount: due.length,
      expiredCount: expired.length,
      attentionCount: due.length + expired.length,
      monthlyTotal: Math.round(monthlyTotal * 100) / 100,
      level: expired.length > 0 ? "expired" : due.length > 0 ? "due" : "none",
      items
    };
  }

  /* ---------------- writes ---------------- */

  function add(draft = {}) {
    const settings = getState().settings;
    const deadline = parseDeadline(draft.renewsAt);
    if (!Number.isFinite(deadline)) throw new Error("续费日期无效");
    const item = normalizeItem({
      ...draft,
      id: randomUUID(),
      cycleDays: draft.cycleDays != null ? draft.cycleDays : settings.defaultCycleDays,
      remindBeforeDays:
        draft.remindBeforeDays != null ? draft.remindBeforeDays : settings.defaultRemindBeforeDays,
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      history: []
    });
    item.renewsAt = new Date(deadline).toISOString();
    clearAlertState(item);
    getState().items.push(item);
    save();
    return toPublic(item);
  }

  function update(id, patch = {}) {
    const item = getState().items.find((entry) => entry.id === id);
    if (!item) throw new Error("订阅不存在");
    const before = parseDeadline(item.renewsAt);

    if (typeof patch.name === "string" && patch.name.trim()) item.name = patch.name.trim();
    if (typeof patch.payUrl === "string") item.payUrl = patch.payUrl.trim();
    if (typeof patch.currency === "string" && patch.currency.trim()) item.currency = patch.currency.trim();
    if (typeof patch.muted === "boolean") item.muted = patch.muted;
    if (typeof patch.archived === "boolean") item.archived = patch.archived;
    if (patch.renewFrom === "today" || patch.renewFrom === "oldDeadline") item.renewFrom = patch.renewFrom;
    if (typeof patch.amount !== "undefined") {
      item.amount = patch.amount === null || patch.amount === "" ? null : Number(patch.amount);
      if (item.amount !== null && !Number.isFinite(item.amount)) throw new Error("金额必须是数字");
    }
    if (typeof patch.cycleDays !== "undefined") {
      item.cycleDays = clampInt(patch.cycleDays, 1, 3650, item.cycleDays);
    }
    if (typeof patch.remindBeforeDays !== "undefined") {
      item.remindBeforeDays = clampInt(patch.remindBeforeDays, 0, 60, item.remindBeforeDays);
    }
    if (typeof patch.renewsAt !== "undefined") {
      const deadline = parseDeadline(patch.renewsAt);
      if (!Number.isFinite(deadline)) throw new Error("续费日期无效");
      item.renewsAt = new Date(deadline).toISOString();
      pushHistory(item, {
        from: Number.isFinite(before) ? new Date(before).toISOString() : null,
        to: item.renewsAt,
        days: null,
        source: "manual-date"
      });
      clearAlertState(item);
    }
    item.updatedAt = new Date(now()).toISOString();
    save();
    return toPublic(item);
  }

  function remove(id) {
    const state = getState();
    state.items = state.items.filter((entry) => entry.id !== id);
    save();
    return true;
  }

  /**
   * One-click renewal. Default extension is the item's own cycle (30 days by
   * default). renewFrom decides the base: "today" starts from the moment you
   * clicked (you paid today), "oldDeadline" stacks on the previous deadline
   * for prepaid billing.
   */
  function renew(id, days, options = {}) {
    const item = getState().items.find((entry) => entry.id === id);
    if (!item) throw new Error("订阅不存在");
    const extension = clampInt(days, 1, 3650, item.cycleDays);
    const nowMs = now();
    const previous = parseDeadline(item.renewsAt);
    const base =
      item.renewFrom === "oldDeadline" && Number.isFinite(previous)
        ? Math.max(previous, nowMs)
        : nowMs;
    const next = base + extension * DAY_MS;
    item.renewsAt = new Date(next).toISOString();
    pushHistory(item, {
      from: Number.isFinite(previous) ? new Date(previous).toISOString() : null,
      to: item.renewsAt,
      days: extension,
      source: options.source || "manual"
    });
    clearAlertState(item);
    item.updatedAt = item.renewsAt;
    save();
    return toPublic(item);
  }

  function renewAllDue(days) {
    const nowMs = now();
    const renewed = [];
    for (const item of activeItems()) {
      if (statusOf(item, nowMs) === "ok") continue;
      renewed.push(renew(item.id, days, { source: "bulk" }));
    }
    return renewed;
  }

  function snooze(id, ms) {
    const target = id == null ? activeItems() : getState().items.filter((entry) => entry.id === id);
    const until = new Date(now() + Math.max(1, Number(ms) || 60 * 60 * 1000)).toISOString();
    for (const item of target) item.snoozedUntil = until;
    save();
    return until;
  }

  /* ---------------- alert scan ---------------- */

  /**
   * Called by the main process on a timer. Returns the current overall level
   * plus the items that crossed into an alert state since the last call and
   * are not throttled / snoozed. Throttling is persisted (lastAlertAt) so a
   * restart cannot re-fire the same reminder.
   */
  function scan() {
    const nowMs = now();
    const settings = getState().settings;
    const alerts = [];
    let dirty = false;

    if (settings.enabled) {
      for (const item of activeItems()) {
        const status = statusOf(item, nowMs);
        if (status === "ok" || item.muted) continue;
        const snoozed = parseDeadline(item.snoozedUntil);
        if (Number.isFinite(snoozed) && nowMs < snoozed) continue;
        const last = Date.parse(item.lastAlertAt || "");
        if (Number.isFinite(last) && nowMs - last < ALERT_THROTTLE_MS) continue;
        item.lastAlertAt = new Date(nowMs).toISOString();
        dirty = true;
        alerts.push(toPublic(item, nowMs));
      }
    }
    if (dirty) save();
    const state = summary();
    return { level: state.level, alerts, items: state.items, summary: state };
  }

  return {
    getSettings,
    setSettings,
    list,
    summary,
    add,
    update,
    remove,
    renew,
    renewAllDue,
    snooze,
    scan
  };
}

module.exports = {
  createSubscriptionStore,
  parseDeadline,
  statusOf,
  daysLeftOf,
  DAY_MS,
  ALERT_THROTTLE_MS,
  DEFAULT_SETTINGS
};
