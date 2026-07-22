const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { getQuota } = require("./quota-service");
const store = require("./store");

let mainWindow;
let tray;
let isAlwaysOnTop = true;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
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
    mainWindow.show();
    placeWindowTopRight();
  });
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
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVR42mNk+M9Qz0AEYBxVSFUBCzAyMjL8Z2BgYJjFqIGjBo4aOAIAgV4EfpO0k7EAAAAASUVORK5CYII="
  );
  tray = new Tray(icon);
  tray.setToolTip("ChatGPT Quota Widget");
  rebuildTrayMenu();
  tray.on("click", toggleWindow);
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏", click: toggleWindow },
      { label: "刷新额度", click: () => mainWindow?.webContents.send("quota:refresh") },
      {
        label: isAlwaysOnTop ? "取消置顶" : "置顶",
        click: () => setAlwaysOnTop(!isAlwaysOnTop)
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
}

function setAlwaysOnTop(value) {
  isAlwaysOnTop = Boolean(value);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    mainWindow.webContents.send("window:alwaysOnTopChanged", isAlwaysOnTop);
  }
  rebuildTrayMenu();
  return isAlwaysOnTop;
}

function toggleWindow() {
  if (!mainWindow) return;
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

  ipcMain.handle("quota:get", async () => readCurrentQuota());
  ipcMain.handle("window:minimize", () => mainWindow?.hide());
  ipcMain.handle("window:close", () => app.quit());
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
    const snapshot = await getQuota();
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
    const snapshot = await getQuota();
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
    const q = await getQuota();
    const identity = accountIdentity(q.currentAccount);
    return store.bindAccount(targetId, identity, withoutCurrentAccount(q));
  });

  ipcMain.handle("store:setResetCount", (_e, id, n) => store.setResetCount(id, n));
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function withoutCurrentAccount(snapshot) {
  const { currentAccount: _currentAccount, ...quota } = snapshot;
  return quota;
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
  const snapshot = await getQuota();
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

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
