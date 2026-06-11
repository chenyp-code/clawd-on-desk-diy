// Smoke test: load completion-bubble module and verify its API surface
// matches the contract main.js expects. Run with:
//   node test/completion-bubble-smoke.js

const electronPath = require.resolve("electron");
const taskbarPath = require.resolve("../src/taskbar");

const previousElectron = Object.prototype.hasOwnProperty.call(require.cache, electronPath)
  ? require.cache[electronPath] : null;
const previousTaskbar = Object.prototype.hasOwnProperty.call(require.cache, taskbarPath)
  ? require.cache[taskbarPath] : null;

require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    BrowserWindow: class {
      constructor() { this.webContents = { send() {}, isLoading() { return false }, once() {} }; }
      isDestroyed() { return true; }
      getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
      showInactive() {}
      hide() {}
      setAlwaysOnTop() {}
      on() {}
      loadFile() {}
      setBounds() {}
      destroy() {}
      isVisible() { return false; }
    },
    ipcMain: { on() {}, removeListener() {} },
    contextBridge: { exposeInMainWorld() {} },
    ipcRenderer: { on() {}, send() {} },
  },
};
require.cache[taskbarPath] = {
  id: taskbarPath, filename: taskbarPath, loaded: true,
  exports: { keepOutOfTaskbar: () => {} },
};

const cb = require("../src/completion-bubble");

const ctx = {
  win: null,
  bubbleFollowPet: false,
  petHidden: false,
  miniMode: false,
  getBubblePolicy: () => ({ enabled: true, autoCloseMs: 2000, bypassDnd: true }),
  getPendingPermissions: () => [],
  getUpdateBubble: () => null,
  getPetWindowBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
  getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
  guardAlwaysOnTop: () => {},
  reapplyMacVisibility: () => {},
  getHudReservedOffset: () => 0,
};

const api = cb(ctx);

const expected = [
  "showCompletionBubble",
  "hideCompletionBubble",
  "repositionCompletionBubble",
  "handleCompletionBubbleAction",
  "handleCompletionBubbleHeight",
  "syncVisibility",
  "hideForPolicy",
  "refreshAutoCloseForPolicy",
  "cleanup",
  "getBubbleWindow",
];
const missing = expected.filter((k) => typeof api[k] !== "function");
if (missing.length) {
  console.error("MISSING API METHODS:", missing);
  process.exit(1);
}
console.log("✓ completion-bubble API surface OK:", expected.length, "methods");
console.log("✓ __test exports:", Object.keys(cb.__test));

// Verify registerCompletionBubbleIpc exists and has the right shape
if (typeof cb.registerCompletionBubbleIpc !== "function") {
  console.error("MISSING: registerCompletionBubbleIpc");
  process.exit(1);
}

const ipcHandlers = {};
const fakeIpcMain = {
  on(channel, listener) { ipcHandlers[channel] = listener; },
  removeListener(channel) { delete ipcHandlers[channel]; },
};

const reg = cb.registerCompletionBubbleIpc({ ipcMain: fakeIpcMain, completionBubble: api });
if (typeof reg.dispose !== "function") {
  console.error("MISSING: registerCompletionBubbleIpc().dispose");
  process.exit(1);
}
const expectedChannels = ["completion-bubble-height", "completion-bubble-action"];
const registeredChannels = Object.keys(ipcHandlers);
const missingChannels = expectedChannels.filter((c) => !ipcHandlers[c]);
if (missingChannels.length) {
  console.error("MISSING IPC CHANNELS:", missingChannels);
  process.exit(1);
}
console.log("✓ IPC channels registered:", registeredChannels);

reg.dispose();
const afterDispose = Object.keys(ipcHandlers);
if (afterDispose.length !== 0) {
  console.error("IPC channels not cleaned up:", afterDispose);
  process.exit(1);
}
console.log("✓ IPC dispose cleans up all channels");

// Restore mocks
if (previousElectron) require.cache[electronPath] = previousElectron;
else delete require.cache[electronPath];
if (previousTaskbar) require.cache[taskbarPath] = previousTaskbar;
else delete require.cache[taskbarPath];

console.log("\nAll smoke checks passed.");