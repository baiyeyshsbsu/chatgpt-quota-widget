/**
 * Local persistence for the widget.
 * Stores per-account quota readings and a manually maintained reset count.
 * Zero extra dependencies: a JSON file in Electron's userData directory.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { randomUUID } = require("node:crypto");

const DEFAULTS = { version: 4, activeAccountId: null, selectedSub2apiAccountId: null, accounts: [] };

let state = null;
let storePath = null;
let legacyStorePathToRemove = null;

function getStorePath() {
  if (!storePath) storePath = path.join(app.getPath("userData"), "store.json");
  return storePath;
}

function getState() {
  if (!state) state = loadStore();
  return state;
}

function loadStore() {
  const currentPath = getStorePath();
  const legacyPath = path.join(app.getPath("appData"), "codex-led-widget", "store.json");
  const current = readStore(currentPath);
  const legacy = legacyPath !== currentPath ? readStore(legacyPath) : null;

  if (!current && !legacy) return JSON.parse(JSON.stringify(DEFAULTS));

  const mergedAccounts = [];
  for (const account of [...(legacy?.accounts || []), ...(current?.accounts || [])]) {
    const matchIndex = mergedAccounts.findIndex((item) =>
      account.accountKey ? item.accountKey === account.accountKey : item.id === account.id
    );
    if (matchIndex >= 0) mergedAccounts[matchIndex] = { ...mergedAccounts[matchIndex], ...account };
    else mergedAccounts.push(account);
  }

  if (legacy) legacyStorePathToRemove = legacyPath;
  return {
    version: 4,
    activeAccountId: current?.activeAccountId || legacy?.activeAccountId || null,
    selectedSub2apiAccountId:
      current?.selectedSub2apiAccountId || legacy?.selectedSub2apiAccountId || null,
    accounts: mergedAccounts
  };
}

function readStore(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      activeAccountId: parsed && parsed.activeAccountId ? parsed.activeAccountId : null,
      selectedSub2apiAccountId:
        parsed && parsed.selectedSub2apiAccountId ? String(parsed.selectedSub2apiAccountId) : null,
      accounts: Array.isArray(parsed && parsed.accounts) ? parsed.accounts : []
    };
  } catch {
    return null;
  }
}

function saveStore() {
  const p = getStorePath();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(getState(), null, 2));
  fs.renameSync(tmp, p); // atomic on same volume
  if (legacyStorePathToRemove) {
    try {
      fs.unlinkSync(legacyStorePathToRemove);
      legacyStorePathToRemove = null;
    } catch {
      // The migrated data is already safe in the new store; stale cache cleanup can wait.
    }
  }
}

/* ---------------- reads ---------------- */
function getStore() {
  return getState();
}
function toPublicAccount(account) {
  if (!account) return null;
  const { accountKey: _accountKey, ...publicAccount } = account;
  return { ...publicAccount };
}
function getAccounts() {
  return getState().accounts.map(toPublicAccount);
}
function getActiveAccount() {
  const s = getState();
  return toPublicAccount(s.accounts.find((a) => a.id === s.activeAccountId) || null);
}
function getSelectedSub2apiAccountId() {
  return getState().selectedSub2apiAccountId || null;
}
function setSelectedSub2apiAccountId(id) {
  const value = id == null ? null : String(id);
  getState().selectedSub2apiAccountId = value;
  saveStore();
  return value;
}
/* ---------------- account CRUD ---------------- */
function applySnapshot(acc, snapshot, options = {}) {
  if (!snapshot) return;
  const manualPercent = Number(acc.manualRemainingPercent);
  const manualDeadline = acc.manualUntilResetsAt ? new Date(acc.manualUntilResetsAt).getTime() : null;
  const sameWindow = !acc.manualUntilResetsAt || snapshot.resetsAt === acc.manualUntilResetsAt;
  const bulkResetActive =
    acc.manualAdjustmentReason === "bulk-reset" &&
    Number.isFinite(manualDeadline) &&
    manualDeadline > Date.now();
  const manualActive =
    Number.isFinite(manualPercent) &&
    (bulkResetActive ||
      (sameWindow && (!Number.isFinite(manualDeadline) || manualDeadline > Date.now())));
  acc.planType = snapshot.planType ?? acc.planType;
  if (!manualActive || options.forceRemaining) {
    acc.remainingPercent = snapshot.remainingPercent ?? acc.remainingPercent;
    delete acc.manualRemainingPercent;
    delete acc.manualUntilResetsAt;
    delete acc.manualAdjustedAt;
    delete acc.manualAdjustmentReason;
  } else {
    acc.remainingPercent = manualPercent;
  }
  if (!bulkResetActive || options.forceRemaining) {
    acc.resetsAt = snapshot.resetsAt ?? acc.resetsAt;
  }
  acc.fetchedAt = snapshot.fetchedAt ?? acc.fetchedAt;
  acc.lastRefreshedAt = new Date().toISOString();
}

function addAccount(label, identity, snapshot) {
  const s = getState();
  if (!identity?.key) throw new Error("无法识别当前登录账号");
  const existing = s.accounts.find((a) => a.accountKey === identity.key);
  if (existing) {
    existing.label = (label && String(label).trim()) || existing.label;
    existing.accountHint = identity.hint || existing.accountHint;
    applySnapshot(existing, snapshot, { forceRemaining: true });
    s.activeAccountId = existing.id;
    saveStore();
    return toPublicAccount(existing);
  }
  const account = {
    id: randomUUID(),
    label: (label && String(label).trim()) || `账号 ${s.accounts.length + 1}`,
    planType: "unknown",
    remainingPercent: null,
    resetsAt: null,
    resetCount: 0,
    lastRefreshedAt: null,
    fetchedAt: null
  };
  account.accountKey = identity.key;
  account.accountHint = identity.hint || "";
  applySnapshot(account, snapshot, { forceRemaining: true });
  s.accounts.push(account);
  s.activeAccountId = account.id;
  saveStore();
  return toPublicAccount(account);
}

function bindAccount(id, identity, snapshot) {
  const s = getState();
  if (!identity?.key) throw new Error("无法识别当前登录账号");
  const duplicate = s.accounts.find((a) => a.id !== id && a.accountKey === identity.key);
  if (duplicate) throw new Error(`当前账号已绑定到“${duplicate.label}”`);
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) throw new Error("账号不存在");
  acc.accountKey = identity.key;
  acc.accountHint = identity.hint || "";
  applySnapshot(acc, snapshot, { forceRemaining: true });
  s.activeAccountId = acc.id;
  saveStore();
  return toPublicAccount(acc);
}

function observeAccount(identity, snapshot) {
  const s = getState();
  const acc = identity?.key ? s.accounts.find((a) => a.accountKey === identity.key) : null;
  if (!acc) {
    if (identity?.key) {
      return addAccount(identity.hint || `账号 ${s.accounts.length + 1}`, identity, snapshot);
    }
    if (s.activeAccountId !== null) {
      s.activeAccountId = null;
      saveStore();
    }
    return null;
  }
  s.activeAccountId = acc.id;
  acc.accountHint = identity.hint || acc.accountHint;
  applySnapshot(acc, snapshot);
  saveStore();
  return toPublicAccount(acc);
}

function removeAccount(id) {
  const s = getState();
  s.accounts = s.accounts.filter((a) => a.id !== id);
  if (s.activeAccountId === id) s.activeAccountId = null;
  saveStore();
}

function setActiveAccount(id) {
  const s = getState();
  if (!s.accounts.some((a) => a.id === id)) return null;
  s.activeAccountId = id;
  saveStore();
  return getActiveAccount();
}

/* ---------------- readings & manual count ---------------- */
// snapshot = { planType, remainingPercent, resetsAt, fetchedAt }
function updateAccountReading(id, snapshot) {
  const s = getState();
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) return null;
  applySnapshot(acc, snapshot);
  saveStore();
  return toPublicAccount(acc);
}

function setResetCount(id, n) {
  const s = getState();
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) return null;
  acc.resetCount = Math.max(0, Math.floor(Number(n) || 0));
  saveStore();
  return toPublicAccount(acc);
}

function resetAllAccountQuotas(now = new Date()) {
  const s = getState();
  const resetAt = new Date(now);
  if (Number.isNaN(resetAt.getTime())) throw new Error("重置时间无效");

  const adjustedAt = resetAt.toISOString();
  const resetsAt = new Date(resetAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const acc of s.accounts) {
    acc.remainingPercent = 100;
    acc.resetsAt = resetsAt;
    acc.manualRemainingPercent = 100;
    acc.manualUntilResetsAt = resetsAt;
    acc.manualAdjustedAt = adjustedAt;
    acc.manualAdjustmentReason = "bulk-reset";
    acc.lastRefreshedAt = adjustedAt;
  }
  saveStore();
  return {
    count: s.accounts.length,
    resetsAt,
    accounts: s.accounts.map(toPublicAccount)
  };
}

function setManualRemainingPercent(id, value) {
  const s = getState();
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) throw new Error("账号不存在");
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error("额度必须是 0 到 100 之间的数字");
  }
  acc.remainingPercent = Math.round(percent);
  acc.manualRemainingPercent = acc.remainingPercent;
  acc.manualUntilResetsAt = acc.resetsAt || null;
  acc.manualAdjustedAt = new Date().toISOString();
  delete acc.manualAdjustmentReason;
  acc.lastRefreshedAt = acc.manualAdjustedAt;
  saveStore();
  return toPublicAccount(acc);
}

module.exports = {
  getStore,
  getAccounts,
  getActiveAccount,
  getSelectedSub2apiAccountId,
  setSelectedSub2apiAccountId,
  addAccount,
  bindAccount,
  observeAccount,
  removeAccount,
  setActiveAccount,
  updateAccountReading,
  setResetCount,
  resetAllAccountQuotas,
  setManualRemainingPercent
};
