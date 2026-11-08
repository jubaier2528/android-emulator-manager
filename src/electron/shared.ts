export type Orientation = "Portrait" | "Landscape";
export type GraphicsMode = "auto" | "host" | "swiftshader_indirect" | "angle_indirect" | "guest";

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
  avdName?: string;
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
  getSdkStatus(): Promise<SdkStatus>;
  listAvds(): Promise<AvdInfo[]>;
  listConnectedDevices(): Promise<ConnectedDevice[]>;
  listSystemImages(): Promise<SystemImage[]>;
  listDeviceProfiles(): Promise<DeviceProfile[]>;
  launch(options: LaunchOptions): Promise<void>;
  stop(avdName: string): Promise<void>;
  createAvd(options: CreateAvdOptions): Promise<void>;
  onLog(callback: (log: EmulatorLog) => void): () => void;
}
