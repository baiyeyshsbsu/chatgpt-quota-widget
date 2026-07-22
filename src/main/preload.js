const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatgptQuota", {
  getQuota: () => ipcRenderer.invoke("quota:get"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:alwaysOnTop:get"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("window:alwaysOnTop:set", value),
  openChatGpt: () => ipcRenderer.invoke("external:openChatGpt"),
  onRefresh: (callback) => {
    ipcRenderer.on("quota:refresh", callback);
  },
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on("window:alwaysOnTopChanged", (_event, value) => callback(value));
  },
  // ---- multi-account local storage ----
  getAccounts: () => ipcRenderer.invoke("store:getAccounts"),
  getActiveAccount: () => ipcRenderer.invoke("store:getActiveAccount"),
  addAccount: (label) => ipcRenderer.invoke("store:addAccount", label),
  removeAccount: (id) => ipcRenderer.invoke("store:removeAccount", id),
  setActiveAccount: (id) => ipcRenderer.invoke("store:setActiveAccount", id),
  bindAccount: (id) => ipcRenderer.invoke("store:bindAccount", id),
  saveReading: (id) => ipcRenderer.invoke("store:saveReading", id),
  setResetCount: (id, n) => ipcRenderer.invoke("store:setResetCount", id, n),
  setManualRemainingPercent: (id, value) =>
    ipcRenderer.invoke("store:setManualRemainingPercent", id, value),
  setView: (v) => ipcRenderer.invoke("window:view:set", v)
});
