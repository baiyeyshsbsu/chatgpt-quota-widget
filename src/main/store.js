/**
 * Local persistence for the widget.
 * Stores per-account quota readings and a manually maintained reset count.
 * Zero extra dependencies: a JSON file in Electron's userData directory.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { randomUUID } = require("node:crypto");

const DEFAULTS = { version: 3, activeAccountId: null, accounts: [] };

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
    version: 3,
    activeAccountId: current?.activeAccountId || legacy?.activeAccountId || null,
    accounts: mergedAccounts
  };
}

function readStore(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      activeAccountId: parsed && parsed.activeAccountId ? parsed.activeAccountId : null,
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
/* ---------------- account CRUD ---------------- */
function applySnapshot(acc, snapshot) {
  if (!snapshot) return;
  acc.planType = snapshot.planType ?? acc.planType;
  acc.remainingPercent = snapshot.remainingPercent ?? acc.remainingPercent;
  acc.resetsAt = snapshot.resetsAt ?? acc.resetsAt;
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
    applySnapshot(existing, snapshot);
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
  applySnapshot(account, snapshot);
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
  applySnapshot(acc, snapshot);
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

module.exports = {
  getStore,
  getAccounts,
  getActiveAccount,
  addAccount,
  bindAccount,
  observeAccount,
  removeAccount,
  setActiveAccount,
  updateAccountReading,
  setResetCount
};
