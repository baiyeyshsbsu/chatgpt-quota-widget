const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { getQuota, diagnoseQuotaError, QUOTA_ERROR } = require("./quota-service");
const sub2api = require("./sub2api-service");
const { createSubscriptionStore } = require("./subscription-store");

const SUB2API_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SUBSCRIPTION_SCAN_INTERVAL_MS = 60 * 1000;
const SUBSCRIPTION_FIRST_SCAN_DELAY_MS = 3000;
const MODE_PERSONAL = "personal";
const MODE_RELAY = "relay";
const WINDOW_7D = "7d";
const WINDOW_5H = "5h";
const RAIL_WIDTH = 88;
const RAIL_HEIGHT = 620;
const ACCOUNTS_PANEL_WIDTH = 390;
const ACCOUNTS_WIDTH = ACCOUNTS_PANEL_WIDTH + RAIL_WIDTH;
const MIN_VIEW_HEIGHT = 236;
const VIEW_TRANSITION_MS = 220;

let mainWindow;
let tray;
let isQuitting = false;
let lastSub2apiAccounts = [];
let accountsRefreshPromise = null;
let accountsRefreshIsForce = false;
let accountsRefreshTimer = null;
let boundsAnimationToken = 0;
let isAnimatingBounds = false;
let subscriptionStore = null;
let subscriptionScanTimer = null;
let subscriptionFirstScanTimer = null;
let lastSubscriptionLevel = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: RAIL_WIDTH,
    height: RAIL_HEIGHT,
    minWidth: RAIL_WIDTH,
    minHeight: MIN_VIEW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "../../assets/app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    placeWindowRestored();
  });
  let lastAnchor = (() => {
    const saved = readPreferences().windowAnchor;
    return saved && Number.isFinite(saved.right) && Number.isFinite(saved.y)
      ? { right: Math.round(saved.right), y: Math.round(saved.y) }
      : null;
  })();
  let posWatchdog = null;
  // Electron's "moved" event is macOS-only; poll the position instead. The
  // anchor is always stored as the rail's right edge, whether the drawer is
  // open or not, so view animations never look like a user drag.
  posWatchdog = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || isAnimatingBounds) return;
    const { x, y, width } = mainWindow.getBounds();
    const anchor = {
      right: x + width - (width > RAIL_WIDTH ? ACCOUNTS_WIDTH - RAIL_WIDTH : 0),
      y
    };
    if (lastAnchor && lastAnchor.right === anchor.right && lastAnchor.y === anchor.y) return;
    lastAnchor = anchor;
    writePreferences({ windowAnchor: anchor });
  }, 2000);
  mainWindow.on("closed", () => {
    clearInterval(posWatchdog);
    mainWindow = null;
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeLog("renderer-gone", `${details.reason || "unknown"}; code=${details.exitCode ?? "unknown"}`);
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => mainWindow && !mainWindow.isDestroyed() && mainWindow.reload(), 800);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    writeLog("renderer-load-failed", `code=${code}; ${description || "unknown"}`);
  });
  return mainWindow;
}

function topRightBounds(width, height) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  return {
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height
  };
}

/**
 * Anchored bounds honour the position the user dragged the rail to
 * (persisted as the rail's right edge + top). Falls back to the top-right
 * corner when nothing was saved or the anchor no longer lands on a screen.
 */
function anchoredBounds(width, height) {
  const anchor = readPreferences().windowAnchor;
  if (!anchor || !Number.isFinite(anchor.right) || !Number.isFinite(anchor.y)) {
    return topRightBounds(width, height);
  }
  const point = screen.getDisplayNearestPoint({ x: Math.round(anchor.right), y: Math.round(anchor.y) });
  const { workArea } = point;
  const x = Math.max(workArea.x, Math.min(Math.round(anchor.right) - width, workArea.x + workArea.width - width));
  const y = Math.max(workArea.y, Math.min(Math.round(anchor.y), workArea.y + workArea.height - height));
  return { x, y, width, height };
}

function placeWindowTopRight() {
  if (!mainWindow) return;
  const { width, height } = mainWindow.getBounds();
  mainWindow.setBounds(topRightBounds(width, height));
}

function placeWindowRestored() {
  if (!mainWindow) return;
  const { width, height } = mainWindow.getBounds();
  mainWindow.setBounds(anchoredBounds(width, height));
}

function animateWindowBounds(targetBounds, duration = VIEW_TRANSITION_MS) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  const token = ++boundsAnimationToken;
  const start = mainWindow.getBounds();
  const right = targetBounds.x + targetBounds.width;
  const startedAt = Date.now();
  isAnimatingBounds = true;
  return new Promise((resolve) => {
    const finish = () => {
      if (token === boundsAnimationToken) isAnimatingBounds = false;
      resolve();
    };
    const step = () => {
      if (token !== boundsAnimationToken || !mainWindow || mainWindow.isDestroyed()) {
        finish();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const width = Math.round(start.width + (targetBounds.width - start.width) * eased);
      const height = Math.round(start.height + (targetBounds.height - start.height) * eased);
      mainWindow.setBounds({
        x: right - width,
        y: targetBounds.y,
        width,
        height
      });
      if (progress >= 1) {
        finish();
        return;
      }
      setTimeout(step, 16);
    };
    step();
  });
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const icon = nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-icon.png"));
  if (icon.isEmpty()) writeLog("tray-icon-empty");
  tray = new Tray(icon);
  tray.setToolTip("ChatGPT Quota Widget");
  rebuildTrayMenu();
  tray.on("click", showWindow);
  return tray;
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示", click: showWindow },
      { type: "separator" },
      { label: "退出", click: quitApplication }
    ])
  );
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  createWindow();
  createTray();
  startSub2apiAccountRefresh();
  startSubscriptionScan();
  openRelayUrlOnStartup();

  ipcMain.handle("quota:get", async () => {
    try {
      return await readQuotaForMode();
    } catch (error) {
      throw quotaIpcError(error);
    }
  });
  ipcMain.handle("window:close", quitApplication);
  ipcMain.handle("external:openChatGpt", () => {
    // 启动 ChatGPT 桌面版（原 Codex）。`codex app` 会打开已安装的桌面应用。
    const codexPath = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin", "codex.exe");
    try {
      const child = spawn(codexPath, ["app"], { detached: true, windowsHide: true, stdio: "ignore" });
      child.unref();
    } catch (_) {
      shell.openPath(codexPath);
    }
  });

  // ---- Sub2API owns the server account list; the LED quota remains local. ----
  ipcMain.handle("sub2api:connection:get", () => sub2api.getConnection());
  ipcMain.handle("usage-mode:get", () => getUsageMode());
  ipcMain.handle("usage-mode:set", async (_event, mode) => {
    const savedMode = setUsageMode(mode);
    if (savedMode === MODE_RELAY && sub2api.getConnection().connected) {
      refreshSub2apiAccountCache().catch(() => {});
    }
    return savedMode;
  });
  ipcMain.handle("quota-window:get", () => getQuotaWindow());
  ipcMain.handle("quota-window:set", (_event, quotaWindow) => setQuotaWindow(quotaWindow));
  ipcMain.handle("external:openRelay", () => {
    if (!sub2api.getConnection().connected) return false;
    openRelayUrl().catch((error) => writeLog("relay-url-open-failed", error?.message || error));
    return true;
  });
  ipcMain.handle("external:openUrl", (_event, url) => {
    const target = String(url || "").trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target).catch((error) => writeLog("external-url-open-failed", error?.message || error));
    return true;
  });
  ipcMain.handle("sub2api:connect", async (_event, credentials) => {
    const result = await sub2api.connect(credentials || {});
    if (result.connected) {
      await refreshSub2apiAccountCache();
      if (getUsageMode() === MODE_RELAY) openRelayUrl().catch(() => {});
    }
    return result;
  });
  ipcMain.handle("sub2api:disconnect", () => {
    lastSub2apiAccounts = [];
    return sub2api.disconnect();
  });
  ipcMain.handle("store:getAccounts", async (_event, options) => {
    try {
      if (options?.refresh || options?.force || lastSub2apiAccounts.length === 0) {
        return await refreshSub2apiAccountCache({ force: Boolean(options?.force) });
      }
      return accountListResult(lastSub2apiAccounts);
    } catch (error) {
      throw quotaIpcError(error);
    }
  });
  // Resize window between the compact LED view and the accounts panel view.
  ipcMain.handle("window:view:set", async (_e, request) => {
    if (!mainWindow) return;
    const view = typeof request === "string" ? request : request?.view;
    const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
    const requestedHeight = Number(request?.height);
    const isAccountsView = view === "accounts";
    const width = isAccountsView ? ACCOUNTS_WIDTH : RAIL_WIDTH;
    const h = isAccountsView
      ? Math.max(RAIL_HEIGHT, Math.min(Number.isFinite(requestedHeight) ? requestedHeight : RAIL_HEIGHT, workArea.height - 48))
      : Math.min(RAIL_HEIGHT, workArea.height - 48);
    await animateWindowBounds(anchoredBounds(width, h));
  });

  // ---- manual renewal reminders (independent of quota readings) ----
  ipcMain.handle("subs:list", () => subscriptions().list());
  ipcMain.handle("subs:summary", () => subscriptions().summary());
  ipcMain.handle("subs:add", (_event, draft) => {
    const item = subscriptions().add(draft || {});
    scanSubscriptions();
    return item;
  });
  ipcMain.handle("subs:update", (_event, id, patch) => {
    const item = subscriptions().update(id, patch || {});
    scanSubscriptions();
    return item;
  });
  ipcMain.handle("subs:remove", (_event, id) => {
    const removed = subscriptions().remove(id);
    scanSubscriptions();
    return removed;
  });
  ipcMain.handle("subs:renew", (_event, id, days) => {
    const item = subscriptions().renew(id, days);
    scanSubscriptions();
    return item;
  });
  ipcMain.handle("subs:renewAll", (_event, days) => {
    const renewed = subscriptions().renewAllDue(days);
    scanSubscriptions();
    return renewed;
  });
  ipcMain.handle("subs:snooze", (_event, id, ms) => {
    const until = subscriptions().snooze(id, ms);
    scanSubscriptions();
    return until;
  });
  ipcMain.handle("subs:settings:get", () => subscriptions().getSettings());
  ipcMain.handle("subs:settings:set", (_event, patch) => {
    const settings = subscriptions().setSettings(patch || {});
    scanSubscriptions();
    return settings;
  });

  app.on("activate", () => {
    createTray();
    showWindow();
  });
});

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApplication() {
  isQuitting = true;
  app.quit();
}

function writeLog(event, detail = "") {
  try {
    const logPath = path.join(app.getPath("userData"), "widget.log");
    const safeDetail = String(detail).replace(/[\r\n]+/g, " ").slice(0, 600);
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${event} ${safeDetail}\n`, "utf8");
  } catch (_) {
    // Logging must never affect the widget lifecycle.
  }
}

function quotaIpcError(error) {
  const diagnostic = error?.code
    ? { code: error.code, message: error.message }
    : diagnoseQuotaError(error);
  writeLog("quota-read-failed", diagnostic.code);
  return new Error(`QUOTA_DIAGNOSTIC|${diagnostic.code}`);
}

async function readCurrentQuota() {
  const snapshot = await getQuotaWithNetworkRetry();
  const { currentAccount, ...rawQuota } = snapshot;
  const quotaWindow = getQuotaWindow();
  const selectedWindow = quotaWindow === WINDOW_5H ? rawQuota.fiveHour : rawQuota.sevenDay;
  const quota = {
    ...rawQuota,
    quotaWindow,
    remainingPercent: selectedWindow?.remainingPercent ?? null,
    usedPercent: selectedWindow?.usedPercent ?? null,
    resetsAt: selectedWindow?.resetsAt ?? null,
    windowKind: quotaWindow
  };
  const hint = maskEmail(currentAccount?.email);
  return {
    ...quota,
    account: {
      recognized: Boolean(currentAccount?.email),
      id: null,
      label: hint || null,
      hint: hint || null
    }
  };
}

async function readQuotaForMode() {
  if (getUsageMode() !== MODE_RELAY) return readCurrentQuota();
  const connection = sub2api.getConnection();
  if (!connection.connected) {
    const error = new Error("请先连接 Sub2API 管理员账号");
    error.code = "sub2api_auth";
    throw error;
  }
  const result = lastSub2apiAccounts.length > 0
    ? accountListResult(lastSub2apiAccounts)
    : await refreshSub2apiAccountCache();
  if (result.accounts.length === 0) {
    const error = new Error("Sub2API 中没有 OpenAI OAuth 账号");
    error.code = "sub2api_empty";
    throw error;
  }
  return sub2api.summarizeAccountQuotas(result.accounts, getQuotaWindow());
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "widget-preferences.json");
}

function readPreferences() {
  try {
    return JSON.parse(fs.readFileSync(preferencesPath(), "utf8")) || {};
  } catch {
    return {};
  }
}

function writePreferences(patch) {
  const target = preferencesPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...readPreferences(), version: 2, ...patch }, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function getUsageMode() {
  return readPreferences().usageMode === MODE_RELAY ? MODE_RELAY : MODE_PERSONAL;
}

function setUsageMode(mode) {
  const usageMode = mode === MODE_RELAY ? MODE_RELAY : MODE_PERSONAL;
  writePreferences({ usageMode });
  return usageMode;
}

function getQuotaWindow() {
  return readPreferences().quotaWindow === WINDOW_5H ? WINDOW_5H : WINDOW_7D;
}

function setQuotaWindow(quotaWindow) {
  const savedWindow = quotaWindow === WINDOW_5H ? WINDOW_5H : WINDOW_7D;
  writePreferences({ quotaWindow: savedWindow });
  return savedWindow;
}

function openRelayUrl() {
  const baseUrl = sub2api.getConnection().baseUrl;
  return shell.openExternal(baseUrl);
}

function openRelayUrlOnStartup() {
  if (getUsageMode() !== MODE_RELAY || !sub2api.getConnection().connected) return;
  openRelayUrl().catch((error) => writeLog("relay-url-open-failed", error?.message || error));
}

async function getQuotaWithNetworkRetry() {
  try {
    return await getQuota();
  } catch (error) {
    if (error?.code !== QUOTA_ERROR.NETWORK) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return getQuota();
  }
}

function maskEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) return "";
  const local = normalized.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${normalized.slice(at)}`;
}

function accountFreshness(account) {
  const sampled = Date.parse(account?.upstreamSampledAt || "");
  const read = Date.parse(account?.serverReadAt || "");
  return Number.isFinite(sampled) ? sampled : Number.isFinite(read) ? read : 0;
}

function mergeSub2apiAccount(account) {
  const index = lastSub2apiAccounts.findIndex((item) => item.id === account.id);
  if (index < 0) {
    lastSub2apiAccounts.push(account);
    return;
  }
  if (accountFreshness(account) >= accountFreshness(lastSub2apiAccounts[index])) {
    lastSub2apiAccounts[index] = account;
  }
}

function mergeSub2apiAccounts(accounts) {
  const incomingIds = new Set(accounts.map((account) => account.id));
  lastSub2apiAccounts = lastSub2apiAccounts.filter((account) => incomingIds.has(account.id));
  for (const account of accounts) mergeSub2apiAccount(account);
  return lastSub2apiAccounts;
}

function accountListResult(accounts) {
  const failures = accounts
    .filter((account) => account.errorCode)
    .map((account) => ({ id: account.id, label: account.label, code: account.errorCode }));
  return {
    accounts,
    refreshedAt: new Date().toISOString(),
    failures
  };
}

async function refreshSub2apiAccountCache({ force = false } = {}) {
  if (accountsRefreshPromise) {
    if (!force || accountsRefreshIsForce) return accountsRefreshPromise;
    try {
      await accountsRefreshPromise;
    } catch {
      // The explicit force request below is an independent retry.
    }
    return refreshSub2apiAccountCache({ force: true });
  }
  accountsRefreshIsForce = force;
  accountsRefreshPromise = (async () => {
    try {
      const accounts = await sub2api.listAccountQuotas({ force });
      const merged = mergeSub2apiAccounts(accounts);
      const result = accountListResult(merged);
      if (result.failures.length > 0) {
        writeLog(
          "sub2api-list-partial",
          `failed=${result.failures.length}; total=${result.accounts.length}`
        );
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("sub2api:accountsUpdated", result);
      }
      return result;
    } catch (error) {
      writeLog("sub2api-list-failed", error?.code || "sub2api_service");
      throw error;
    } finally {
      accountsRefreshPromise = null;
      accountsRefreshIsForce = false;
    }
  })();
  return accountsRefreshPromise;
}

function startSub2apiAccountRefresh() {
  if (accountsRefreshTimer) clearInterval(accountsRefreshTimer);
  accountsRefreshTimer = setInterval(() => {
    if (!sub2api.getConnection().connected) return;
    refreshSub2apiAccountCache().catch(() => {});
  }, SUB2API_REFRESH_INTERVAL_MS);
}

/* ---------------- manual renewal reminders ---------------- */

function subscriptions() {
  if (!subscriptionStore) {
    subscriptionStore = createSubscriptionStore({
      filePath: path.join(app.getPath("userData"), "subscriptions.json")
    });
  }
  return subscriptionStore;
}

function alertTrayIcon() {
  // Tint the shipped tray glyph red by rewriting its BGRA bitmap in place.
  try {
    const base = nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-icon.png"));
    if (base.isEmpty()) return base;
    const { width, height } = base.getSize();
    const bitmap = base.toBitmap();
    for (let i = 0; i + 3 < bitmap.length; i += 4) {
      if (bitmap[i + 3] > 0) {
        bitmap[i] = 0x57; // B
        bitmap[i + 1] = 0x4b; // G
        bitmap[i + 2] = 0xdf; // R  -> #df4b57
      }
    }
    return nativeImage.createFromBitmap(bitmap, { width, height });
  } catch (error) {
    writeLog("tray-alert-icon-failed", error?.message || error);
    return nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-icon.png"));
  }
}

function syncTraySubscriptionBadge(summary) {
  if (!tray || tray.isDestroyed()) return;
  const count = summary.attentionCount || 0;
  const baseTip = "ChatGPT Quota Widget";
  tray.setToolTip(count > 0 ? `${baseTip} · ${count} 项待续费` : baseTip);
  try {
    tray.setImage(count > 0 ? alertTrayIcon() : nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-icon.png")));
  } catch (_) {
    // Badge is cosmetic; never let it break the tray.
  }
}

function scanSubscriptions() {
  let result;
  try {
    result = subscriptions().scan();
  } catch (error) {
    writeLog("subscription-scan-failed", error?.message || error);
    return;
  }
  lastSubscriptionLevel = result.level;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("subs:updated", {
      level: result.level,
      items: result.items,
      summary: result.summary
    });
    if (result.alerts.length > 0) {
      mainWindow.webContents.send("subs:alert", {
        level: result.level,
        alerts: result.alerts,
        summary: result.summary
      });
    }
  }
  syncTraySubscriptionBadge(result.summary);
  if (result.alerts.length > 0 && subscriptions().getSettings().channels.balloon && tray && !tray.isDestroyed()) {
    const names = result.alerts.map((item) => item.name).join("、");
    tray.displayBalloon({
      title: result.level === "expired" ? "有订阅已过期" : "该续费了",
      content: `${names} — 打开组件点「已续费」即可顺延`,
      iconType: "warning"
    });
  }
}

function startSubscriptionScan() {
  if (subscriptionScanTimer) clearInterval(subscriptionScanTimer);
  if (subscriptionFirstScanTimer) clearTimeout(subscriptionFirstScanTimer);
  subscriptionFirstScanTimer = setTimeout(() => {
    scanSubscriptions();
  }, SUBSCRIPTION_FIRST_SCAN_DELAY_MS);
  subscriptionScanTimer = setInterval(scanSubscriptions, SUBSCRIPTION_SCAN_INTERVAL_MS);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  isQuitting = true;
  if (accountsRefreshTimer) clearInterval(accountsRefreshTimer);
  if (subscriptionScanTimer) clearInterval(subscriptionScanTimer);
  if (subscriptionFirstScanTimer) clearTimeout(subscriptionFirstScanTimer);
});
process.on("uncaughtExceptionMonitor", (error) => {
  writeLog("uncaught-exception", error?.message || error);
});
