const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("completionBubbleAPI", {
  onShow: (cb) => ipcRenderer.on("completion-bubble-show", (_, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on("completion-bubble-hide", () => cb()),
  choose: (actionId) => ipcRenderer.send("completion-bubble-action", actionId),
  reportHeight: (height) => ipcRenderer.send("completion-bubble-height", height),
});