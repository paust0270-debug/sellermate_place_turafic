const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("placeGui", {
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  getPathInfo: () => ipcRenderer.invoke("get-path-info"),
  healthCheck: () => ipcRenderer.invoke("health-check"),
  runnerStatus: () => ipcRenderer.invoke("runner-status"),
  runnerStart: (opts) => ipcRenderer.invoke("runner-start", opts),
  runnerStop: () => ipcRenderer.invoke("runner-stop"),
  onRunnerLog: (fn) => ipcRenderer.on("runner-log", (_e, payload) => fn(payload)),
  onRunnerExit: (fn) => ipcRenderer.on("runner-exit", (_e, payload) => fn(payload)),
});
