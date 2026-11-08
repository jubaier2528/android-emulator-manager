import { contextBridge, ipcRenderer } from "electron";
import type { EmulatorApi, EmulatorLog } from "./shared";

const api: EmulatorApi = {
  getSdkStatus: () => ipcRenderer.invoke("sdk:status"),
  listAvds: () => ipcRenderer.invoke("avd:list"),
  listConnectedDevices: () => ipcRenderer.invoke("adb:devices"),
  listSystemImages: () => ipcRenderer.invoke("sdk:images"),
  listDeviceProfiles: () => ipcRenderer.invoke("sdk:profiles"),
  launch: (options) => ipcRenderer.invoke("emulator:launch", options),
  stop: (avdName) => ipcRenderer.invoke("emulator:stop", avdName),
  createAvd: (options) => ipcRenderer.invoke("avd:create", options),
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, log: EmulatorLog) => callback(log);
    ipcRenderer.on("app:log", listener);
    return () => ipcRenderer.removeListener("app:log", listener);
  }
};

contextBridge.exposeInMainWorld("emulatorManager", api);
