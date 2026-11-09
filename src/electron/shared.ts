export type Orientation = "Portrait" | "Landscape";
export type GraphicsMode = "auto" | "host" | "swiftshader_indirect" | "angle_indirect" | "guest";
export type ProxyMode = "none" | "system" | "http" | "socks5";

export type EmulatorProxy =
  | { mode: "none" }
  | { mode: "system" }
  | { mode: "http" | "socks5"; host: string; port: number; username?: string; password?: string };

export interface DeviceChoice {
  id: string;
  name: string;
  brand: string;
}

export interface AvdInfo {
  name: string;
  displayName: string;
  status: "running" | "starting" | "stopped";
  catalogDeviceId?: string;
  compatible?: boolean;
  systemImageVendor?: string;
  systemImageFlavor?: string;
  serial?: string;
  deviceName?: string;
  manufacturer?: string;
  resolution?: string;
  screenSize?: string;
  ram?: string;
  androidVersion?: string;
  apiLevel?: string;
  orientation?: Orientation;
  graphics?: GraphicsMode;
}

export interface SdkStatus {
  installed: boolean;
  sdkPath?: string;
  emulatorPath?: string;
  adbPath?: string;
  avdmanagerPath?: string;
  sdkmanagerPath?: string;
  scrcpyPath?: string;
  message: string;
}

export interface SystemImage {
  packagePath: string;
  label: string;
  apiLevel: string;
  abi: string;
  vendorId?: string;
  osFlavor?: string;
}

export interface DeviceProfile {
  id: string;
  name: string;
  manufacturer?: string;
}

export interface ConnectedDevice {
  serial: string;
  state: string;
  model?: string;
  manufacturer?: string;
  androidVersion?: string;
  avdName?: string;
  isEmulator?: boolean;
}

export interface IosSimulator {
  udid: string;
  name: string;
  runtime: string;
  state: string;
}

export interface IosSimulatorStatus {
  available: boolean;
  message: string;
  devices: IosSimulator[];
}

export interface ApkSelection {
  id: string;
  name: string;
}

export interface EmulatorLog {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export interface LaunchOptions {
  device: DeviceChoice;
  avdName: string;
  orientation: Orientation;
  graphics: GraphicsMode;
  charging: boolean;
  proxy: EmulatorProxy;
  location?: { latitude: number; longitude: number };
}

export interface CreateAvdOptions {
  name: string;
  deviceId: string;
  systemImage: string;
  catalogDeviceId?: string;
  catalogDeviceName?: string;
  catalogDeviceBrand?: string;
}

export interface EmulatorApi {
  openSamsungRemoteTestLab(): Promise<void>;
  selectApk(): Promise<ApkSelection | undefined>;
  installApk(serial: string, selectionId: string): Promise<void>;
  launchPackage(serial: string, packageName: string): Promise<void>;
  mirrorDevice(serial: string): Promise<void>;
  getSdkStatus(): Promise<SdkStatus>;
  listAvds(): Promise<AvdInfo[]>;
  listConnectedDevices(): Promise<ConnectedDevice[]>;
  getIosSimulatorStatus(): Promise<IosSimulatorStatus>;
  bootIosSimulator(udid: string): Promise<void>;
  shutdownIosSimulator(udid: string): Promise<void>;
  listSystemImages(): Promise<SystemImage[]>;
  listDeviceProfiles(): Promise<DeviceProfile[]>;
  launch(options: LaunchOptions): Promise<void>;
  connectProxy(avdName: string, proxy: EmulatorProxy): Promise<void>;
  testProxy(proxy: EmulatorProxy): Promise<void>;
  setEmulatorLocation(avdName: string, latitude: number, longitude: number): Promise<void>;
  setCharging(avdName: string, charging: boolean): Promise<void>;
  stop(avdName: string): Promise<void>;
  createAvd(options: CreateAvdOptions): Promise<void>;
  onLog(callback: (log: EmulatorLog) => void): () => void;
}
