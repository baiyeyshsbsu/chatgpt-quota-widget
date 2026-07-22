const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { getQuota, diagnoseQuotaError, QUOTA_ERROR } = require("./quota-service");
const store = require("./store");

let mainWindow;
let tray;
let isAlwaysOnTop = true;
let isQuitting = false;
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
    width: 390,
    height: 236,
    minWidth: 390,
    minHeight: 236,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: false,
    show: false,
    backgroundColor: "#00000000",
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
    placeWindowTopRight();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => {
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

function placeWindowTopRight() {
  if (!mainWindow) return;
  const display = screen.getPrimaryDisplay();
  const { width, height } = mainWindow.getBounds();
  const { workArea } = display;
  mainWindow.setBounds({
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height
  });
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAPgSURBVFhH1VdbSFRBGPaxR19qvaRnd0/KbmuetTKju4gUZCQtVApeAiPN1CRSiRQjo1BJE9OEpKCHCgLf7CEqJMTIksgHwYIkKSl6zyCa5pudOTvn7OxN8aEfPg7M5fv/+W8zJ+m/lQ3a1p0O3Tggg0+tjazX8lMyqgKd+vW6uewHl4h3vMuE53E70btqycaDxSTF7Z9yuP1tDs1w8q2rE00zkvVrdU987wb+5n67T2IhZ3aI6B01JMWzjThc/mEYzqkSF2drZaX3Vc8flaJYgCGZVQFCvfHL4c47ySnjl6zB5uGc+RHLqbfMj5Ds0RbiPH2cZAZKQqCKsoYvMKXyesDVdgphod4wOjl1bIFyC9HCKIsx3AqyiKDzUAhD5f0sJJh3+fu4isgCt+cu3DU3+6b6SHphYbiyKEjL30W8z25YjICngvN5tVxVuCBh5JhDeWpugYU8blBveMaumAYgPCwxaU6kaYafq7TKpt6G52ID3J7oye2A8bR6TCOy+puCcy7/GFcZEpw+Z/a2mXRm3FYJJKjgxKEQHoyHecFZVz4kFgp32clWCjQrwe2sL2dj6BFcdVD0vsZFsQglZSdRoajkBDlWVsO+qnkBV3OFaQC6Jh9f4qqD3Q4TYhHcJhPYke3fS15MTBJZ3s58IHuKS5XrkUuCGzkhxs0w4GLZPNFjLuI9PSImX09ztVb5+Okz0bw7lHsENyDGzA6ZqhulchdL373PslnG4UAFV6eW6jPNyn0q/lS3cZ4ZgOaAmjcXRCm/lstdXJVaem/dUe4T3IBIcLM9wxVy08gsOxpGIFBWfZarUkvTxY6wPSg9wc0qjI/j2g4aQB8TaBJiEev7EoEMxPjL4leuzirLy79JbkFR2B5cXoIbJSnGHW6jmhmAJoRTi0UIh0xgB/Lg+4+fXG1QoLy2sVW5Hg8YwS0fDsnPDIA4PNsX0KnEwnhKsf1qD4s5vqqTA6gowQmICsOdoGn713H1NBHpVSmHYTXdEDcfTgr43vSbnL6ZATbGbkb7fYCmwJJF8oLUtRIClAgOFTCP0ueqQwKr5LYJ4AWUqCdiGnCzIdSGZYEXQCCHAsDjIlZ3FEAPkd2ugme86xFXGS6oTRDhQrJvRDajpFQeEe9C+x7f+0Gid9czrwBZoy3TxtK96P8QNBQPQYqrU84JO+zPLjvYA8Rq7JQl8yMJFgkjkJhyHccDGJZx5JCsmCs3krmK+AS9WhAgB/BKinRq3KZ69zmVYvb4iOvkKkGbpiQv7aQAq+coFULzaU5ZbisRECEs6GAqZTLoiZ+afX4thP0N4weUhsgCOp6Yq5OS/gFrxLBMOdj9hwAAAABJRU5ErkJggg=="
  );
  if (icon.isEmpty()) writeLog("tray-icon-empty");
  tray = new Tray(icon);
  tray.setToolTip("ChatGPT Quota Widget");
  rebuildTrayMenu();
  tray.on("click", toggleWindow);
  return tray;
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏", click: toggleWindow },
      { label: "刷新额度", click: () => mainWindow?.webContents.send("quota:refresh") },
      {
        label: isAlwaysOnTop ? "取消置顶" : "置顶",
        click: () => setAlwaysOnTop(!isAlwaysOnTop)
      },
      { type: "separator" },
      { label: "退出", click: quitApplication }
    ])
  );
}

function setAlwaysOnTop(value) {
  isAlwaysOnTop = Boolean(value);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    mainWindow.webContents.send("window:alwaysOnTopChanged", isAlwaysOnTop);
  }
  rebuildTrayMenu();
  return isAlwaysOnTop;
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  createWindow();
  createTray();

  ipcMain.handle("quota:get", async () => {
    try {
      return await readCurrentQuota();
    } catch (error) {
      throw quotaIpcError(error);
    }
  });
  ipcMain.handle("window:minimize", () => mainWindow?.hide());
  ipcMain.handle("window:close", () => mainWindow?.hide());
  ipcMain.handle("window:alwaysOnTop:get", () => isAlwaysOnTop);
  ipcMain.handle("window:alwaysOnTop:set", (_event, value) => setAlwaysOnTop(value));
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

  // ---- multi-account local storage ----
  ipcMain.handle("store:getAccounts", () => store.getAccounts());
  ipcMain.handle("store:getActiveAccount", () => store.getActiveAccount());
  ipcMain.handle("store:addAccount", async (_e, label) => {
    const snapshot = await getQuotaWithNetworkRetry();
    const identity = accountIdentity(snapshot.currentAccount);
    const quota = withoutCurrentAccount(snapshot);
    const account = store.addAccount(label, identity, quota);
    return { account, quota: { ...quota, account: accountContext(account, identity) } };
  });
  ipcMain.handle("store:removeAccount", (_e, id) => {
    store.removeAccount(id);
  });
  ipcMain.handle("store:setActiveAccount", (_e, id) => store.setActiveAccount(id));
  ipcMain.handle("store:bindAccount", async (_e, id) => {
    const snapshot = await getQuotaWithNetworkRetry();
    const identity = accountIdentity(snapshot.currentAccount);
    const quota = withoutCurrentAccount(snapshot);
    const account = store.bindAccount(id, identity, quota);
    return { account, quota: { ...quota, account: accountContext(account, identity) } };
  });

  // "Save current reading": always re-read live quota in the main process
  // so we capture whichever account is signed into the local ChatGPT desktop app.
  ipcMain.handle("store:saveReading", async (_e, id) => {
    const targetId = id || store.getActiveAccount()?.id;
    if (!targetId) throw new Error("请先添加并选择一个账号");
    const q = await getQuotaWithNetworkRetry();
    const identity = accountIdentity(q.currentAccount);
    return store.bindAccount(targetId, identity, withoutCurrentAccount(q));
  });

  ipcMain.handle("store:setResetCount", (_e, id, n) => store.setResetCount(id, n));
  ipcMain.handle("store:setManualRemainingPercent", (_e, id, value) =>
    store.setManualRemainingPercent(id, value)
  );
  // Resize window between the compact LED view and the accounts panel view.
  ipcMain.handle("window:view:set", (_e, request) => {
    if (!mainWindow) return;
    const view = typeof request === "string" ? request : request?.view;
    const display = screen.getPrimaryDisplay();
    const { workArea } = display;
    const requestedHeight = Number(request?.height);
    const h = view === "accounts"
      ? Math.max(236, Math.min(Number.isFinite(requestedHeight) ? requestedHeight : 460, workArea.height - 48))
      : 236;
    mainWindow.setBounds({
      x: workArea.x + workArea.width - 390 - 24,
      y: workArea.y + 24,
      width: 390,
      height: h
    });
  });

  app.on("activate", () => {
    createTray();
    showWindow();
  });
});

function withoutCurrentAccount(snapshot) {
  const { currentAccount: _currentAccount, ...quota } = snapshot;
  return quota;
}

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

function maskEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) return "已识别";
  const local = normalized.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${normalized.slice(at)}`;
}

function accountIdentity(account) {
  if (!account || account.type !== "chatgpt" || !account.email) {
    throw new Error("当前 Codex 登录态未返回可识别的账号邮箱");
  }
  const email = String(account.email).trim().toLowerCase();
  return {
    key: createHash("sha256").update(email).digest("hex"),
    hint: maskEmail(email),
    planType: account.planType || "unknown"
  };
}

function accountContext(account, identity) {
  return {
    recognized: Boolean(account),
    id: account?.id || null,
    label: account?.label || null,
    hint: identity?.hint || null
  };
}

async function readCurrentQuota() {
  const snapshot = await getQuotaWithNetworkRetry();
  const quota = withoutCurrentAccount(snapshot);
  let identity = null;
  let account = null;
  try {
    identity = accountIdentity(snapshot.currentAccount);
    account = store.observeAccount(identity, quota);
  } catch (_) {
    // Quota remains useful even if this auth mode has no stable account identity.
  }
  return { ...quota, account: accountContext(account, identity) };
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

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
app.on("before-quit", () => {
  isQuitting = true;
});
process.on("uncaughtExceptionMonitor", (error) => {
  writeLog("uncaught-exception", error?.message || error);
});
