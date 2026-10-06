const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatgptQuota", {
  getQuota: (options) => ipcRenderer.invoke("quota:get", options),
  close: () => ipcRenderer.invoke("window:close"),
  openChatGpt: () => ipcRenderer.invoke("external:openChatGpt"),
  openRelay: () => ipcRenderer.invoke("external:openRelay"),
  openUrl: (url) => ipcRenderer.invoke("external:openUrl", url),
  getUsageMode: () => ipcRenderer.invoke("usage-mode:get"),
  setUsageMode: (mode) => ipcRenderer.invoke("usage-mode:set", mode),
  getQuotaWindow: () => ipcRenderer.invoke("quota-window:get"),
  setQuotaWindow: (quotaWindow) => ipcRenderer.invoke("quota-window:set", quotaWindow),
  onAccountsUpdated: (callback) => {
    ipcRenderer.on("sub2api:accountsUpdated", (_event, result) => callback(result));
  },
  // ---- Sub2API connection and server-owned accounts ----
  getSub2apiConnection: () => ipcRenderer.invoke("sub2api:connection:get"),
  connectSub2api: (credentials) => ipcRenderer.invoke("sub2api:connect", credentials),
  disconnectSub2api: () => ipcRenderer.invoke("sub2api:disconnect"),
  getAccounts: (options) => ipcRenderer.invoke("store:getAccounts", options),
  setView: (v) => ipcRenderer.invoke("window:view:set", v),
  // ---- manual renewal reminders ----
  listSubscriptions: () => ipcRenderer.invoke("subs:list"),
  getSubscriptionSummary: () => ipcRenderer.invoke("subs:summary"),
  addSubscription: (draft) => ipcRenderer.invoke("subs:add", draft),
  updateSubscription: (id, patch) => ipcRenderer.invoke("subs:update", id, patch),
  removeSubscription: (id) => ipcRenderer.invoke("subs:remove", id),
  renewSubscription: (id, days) => ipcRenderer.invoke("subs:renew", id, days),
  renewAllDue: (days) => ipcRenderer.invoke("subs:renewAll", days),
  snoozeSubscriptions: (id, ms) => ipcRenderer.invoke("subs:snooze", id, ms),
  getSubscriptionSettings: () => ipcRenderer.invoke("subs:settings:get"),
  setSubscriptionSettings: (patch) => ipcRenderer.invoke("subs:settings:set", patch),
  onSubscriptionsUpdated: (callback) => {
    ipcRenderer.on("subs:updated", (_event, payload) => callback(payload));
  },
  onSubscriptionAlert: (callback) => {
    ipcRenderer.on("subs:alert", (_event, payload) => callback(payload));
  }
});
