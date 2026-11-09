import { contextBridge, ipcRenderer } from "electron";
import type { EmulatorApi, EmulatorLog } from "./shared";

const api: EmulatorApi = {
  openSamsungRemoteTestLab: () => ipcRenderer.invoke("external:samsung-rtl"),
  selectApk: () => ipcRenderer.invoke("phone:select-apk"),
  installApk: (serial, selectionId) => ipcRenderer.invoke("phone:install-apk", { serial, selectionId }),
  launchPackage: (serial, packageName) => ipcRenderer.invoke("phone:launch-package", { serial, packageName }),
  mirrorDevice: (serial) => ipcRenderer.invoke("phone:mirror", serial),
  getSdkStatus: () => ipcRenderer.invoke("sdk:status"),
  listAvds: () => ipcRenderer.invoke("avd:list"),
  listConnectedDevices: () => ipcRenderer.invoke("adb:devices"),
  listSystemImages: () => ipcRenderer.invoke("sdk:images"),
  listDeviceProfiles: () => ipcRenderer.invoke("sdk:profiles"),
  launch: (options) => ipcRenderer.invoke("emulator:launch", options),
  setCharging: (avdName, charging) => ipcRenderer.invoke("emulator:charging", { avdName, charging }),
  stop: (avdName) => ipcRenderer.invoke("emulator:stop", avdName),
  createAvd: (options) => ipcRenderer.invoke("avd:create", options),
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, log: EmulatorLog) => callback(log);
    ipcRenderer.on("app:log", listener);
    return () => ipcRenderer.removeListener("app:log", listener);
  }
};

contextBridge.exposeInMainWorld("emulatorManager", api);
