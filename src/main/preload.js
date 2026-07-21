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
  }
});
