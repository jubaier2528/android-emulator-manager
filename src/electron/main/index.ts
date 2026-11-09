import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import type {
  AvdInfo,
  ApkSelection,
  ConnectedDevice,
  CreateAvdOptions,
  DeviceProfile,
  EmulatorProxy,
  EmulatorLog,
  GraphicsMode,
  LaunchOptions,
  Orientation,
  SdkStatus,
  SystemImage
} from "../shared";
import { createEmulatorProxyBridge, testEmulatorProxyConnection } from "./proxyHttpBridge";

const graphicsModes: GraphicsMode[] = ["auto", "host", "swiftshader_indirect", "angle_indirect", "guest"];
const orientations: Orientation[] = ["Portrait", "Landscape"];
const runningProcesses = new Map<string, ChildProcess>();
const apkSelections = new Map<string, string>();
const mirrorProcesses = new Map<string, ChildProcess>();
const socksBridges = new Map<string, { close: () => void }>();
let mainWindow: BrowserWindow | null = null;
let sdkStatus: SdkStatus | undefined;

function log(level: EmulatorLog["level"], message: string): void {
  const entry: EmulatorLog = { timestamp: new Date().toISOString(), level, message };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:log", entry);
}

async function findOnPath(name: string): Promise<string | undefined> {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  const directories = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    process.platform === "darwin" ? "/opt/homebrew/bin" : undefined,
    process.platform === "darwin" ? "/usr/local/bin" : undefined,
    process.platform === "linux" ? "/usr/bin" : undefined
  ].filter((directory): directory is string => Boolean(directory));
  for (const directory of [...new Set(directories)]) {
    const candidate = path.join(directory, filename);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function systemImageMatchesBrand(image: SystemImage, brand: string): boolean {
  if (image.vendorId !== vendorForBrand(brand)) return false;
  const expectedFlavor = brand === "Samsung Galaxy" ? "oneui"
    : brand === "Xiaomi" ? "hyperos"
      : brand === "OnePlus" ? "oxygenos" : "android";
  return image.osFlavor === expectedFlavor;
}

function candidatesForSdk(): string[] {
  const home = os.homedir();
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "darwin" ? path.join(home, "Library/Android/sdk") : undefined,
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? home, "Android/Sdk") : undefined,
    process.platform === "linux" ? path.join(home, "Android/Sdk") : undefined
  ];
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
}

async function findSdk(): Promise<SdkStatus> {
  for (const sdkPath of candidatesForSdk()) {
    const emulatorPath = path.join(sdkPath, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator");
    const adbPath = path.join(sdkPath, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    try {
      await Promise.all([fs.access(emulatorPath), fs.access(adbPath)]);
      const toolDirectory = path.join(sdkPath, "cmdline-tools");
      let cmdlineDirectories: string[] = [];
      try {
        cmdlineDirectories = (await fs.readdir(toolDirectory))
          .filter((name) => name !== "latest")
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      } catch {
        // Command-line tools are optional when managing existing AVDs.
      }
      const commandLineRoots = [
        path.join(toolDirectory, "latest", "bin"),
        ...cmdlineDirectories.map((name) => path.join(toolDirectory, name, "bin")),
        path.join(sdkPath, "tools", "bin")
      ];
      const avdmanagerPath = await findExecutable(commandLineRoots, "avdmanager");
      const sdkmanagerPath = await findExecutable(commandLineRoots, "sdkmanager");
      const scrcpyPath = await findOnPath("scrcpy");
      return {
        installed: true,
        sdkPath,
        emulatorPath,
        adbPath,
        avdmanagerPath,
        sdkmanagerPath,
        scrcpyPath,
        message: avdmanagerPath
          ? "Android SDK, Emulator, ADB, and command-line tools detected."
          : "Android SDK, Emulator, and ADB detected. Install Android SDK Command-line Tools to create AVDs."
      };
    } catch {
      continue;
    }
  }
  return {
    installed: false,
    message: "Android SDK Emulator and ADB were not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to your SDK folder."
  };
}

async function findExecutable(directories: string[], name: string): Promise<string | undefined> {
  const filename = process.platform === "win32" ? `${name}.bat` : name;
  for (const directory of directories) {
    const candidate = path.join(directory, filename);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function findJavaHome(): Promise<string | undefined> {
  const home = os.homedir();
  const candidates = [
    process.env.JAVA_HOME,
    process.env.ANDROID_STUDIO_JBR,
    process.platform === "darwin" ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home" : undefined,
    process.platform === "darwin" ? path.join(home, "Applications/Android Studio.app/Contents/jbr/Contents/Home") : undefined,
    process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Android/Android Studio/jbr") : undefined,
    process.platform === "linux" ? "/opt/android-studio/jbr" : undefined,
    process.platform === "linux" ? path.join(home, "android-studio/jbr") : undefined
  ];
  const javaExecutable = process.platform === "win32" ? "java.exe" : "java";
  for (const candidate of [...new Set(candidates.filter((item): item is string => Boolean(item)))]) {
    try {
      await fs.access(path.join(candidate, "bin", javaExecutable));
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function getSdk(): Promise<SdkStatus> {
  sdkStatus = await findSdk();
  return sdkStatus;
}

function requireTool(tool: "emulatorPath" | "adbPath" | "avdmanagerPath"): string {
  const executable = sdkStatus?.[tool];
  if (!sdkStatus?.installed || !executable) {
    throw new Error(sdkStatus?.message ?? "Android SDK has not been detected.");
  }
  return executable;
}

function run(executable: string, args: string[], timeout = 20_000, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWindowsBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(executable);
    if (isWindowsBatch && /[%!]/.test(executable)) {
      reject(new Error("SDK tool path contains unsupported command-shell characters."));
      return;
    }
    const child = isWindowsBatch
      ? spawn(process.env.ComSpec || "cmd.exe", [
        "/d", "/s", "/c",
        `"${executable}" ${args.map((argument) => `"${argument}"`).join(" ")}`
      ], { shell: false, windowsHide: true, env })
      : spawn(executable, args, { shell: false, windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(executable)} timed out.`));
    }, timeout);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${path.basename(executable)}: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(executable)} exited with code ${code}.`));
    });
  });
}

async function runJavaTool(executable: string, args: string[], timeout = 30_000): Promise<string> {
  const javaHome = await findJavaHome();
  if (!javaHome) {
    throw new Error("Java runtime not found. Install Android Studio or set JAVA_HOME to a JDK/JBR directory.");
  }
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH ?? ""}`
  };
  return run(executable, args, timeout, env);
}

function parseConfig(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

function avdDirectory(): string {
  return process.env.ANDROID_AVD_HOME || path.join(os.homedir(), ".android", "avd");
}

function safeAvdName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

async function readAvdConfig(name: string): Promise<{ ini: Record<string, string>; config: Record<string, string> }> {
  if (!safeAvdName(name)) throw new Error("The AVD name contains unsupported characters.");
  const base = avdDirectory();
  const iniPath = path.join(base, `${name}.ini`);
  const configPath = path.join(base, `${name}.avd`, "config.ini");
  const [iniText, configText] = await Promise.all([
    fs.readFile(iniPath, "utf8").catch(() => ""),
    fs.readFile(configPath, "utf8").catch(() => "")
  ]);
  return { ini: parseConfig(iniText), config: parseConfig(configText) };
}

async function avdSystemImageMetadata(config: Record<string, string>): Promise<{ vendorId?: string; osFlavor?: string }> {
  const sdkPath = sdkStatus?.sdkPath;
  const imageDirectory = config["image.sysdir.1"];
  if (!sdkPath || !imageDirectory) return {};
  const systemImagesRoot = path.resolve(sdkPath, "system-images");
  const sourcePath = path.resolve(sdkPath, imageDirectory, "source.properties");
  if (!sourcePath.startsWith(`${systemImagesRoot}${path.sep}`)) return {};
  const source = parseConfig(await fs.readFile(sourcePath, "utf8").catch(() => ""));
  return {
    vendorId: source["Addon.VendorId"]?.toLowerCase(),
    osFlavor: osFlavorFromMetadata(source)
  };
}

function osFlavorFromMetadata(source: Record<string, string>): string | undefined {
  const metadata = Object.values(source).join(" ").toLowerCase();
  if (/one\s*ui|samsung experience/.test(metadata)) return "oneui";
  if (/hyper\s*os|miui/.test(metadata)) return "hyperos";
  if (/oxygen\s*os/.test(metadata)) return "oxygenos";
  if (source["Addon.VendorId"]?.toLowerCase() === "google") return "android";
  return undefined;
}

function apiFromConfig(config: Record<string, string>, ini: Record<string, string>): string | undefined {
  const value = config["image.sysdir.1"] ?? config["image.sysdir.2"] ?? ini.target ?? "";
  const match = value.match(/android-(\d+)/i);
  return match?.[1];
}

function avdScreenSize(config: Record<string, string>): string | undefined {
  const width = Number(config["hw.lcd.width"]);
  const height = Number(config["hw.lcd.height"]);
  const density = Number(config["hw.lcd.density"]);
  if (!width || !height || !density) return undefined;
  const diagonal = Math.sqrt(width ** 2 + height ** 2) / density;
  return `${diagonal.toFixed(1)} in (configured)`;
}

async function listRunningAvds(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const devices = await run(requireTool("adbPath"), ["devices", "-l"]).catch(() => "");
  for (const line of devices.split(/\r?\n/)) {
    const match = line.match(/^(emulator-\d+)\s+device\b/);
    if (!match) continue;
    const name = await run(requireTool("adbPath"), ["-s", match[1], "emu", "avd", "name"]).catch(() => "");
    const avdName = name.split(/\r?\n/)[0]?.trim();
    if (avdName && safeAvdName(avdName)) result.set(avdName, match[1]);
  }
  return result;
}

async function listAvds(): Promise<AvdInfo[]> {
  const executable = requireTool("emulatorPath");
  const output = await run(executable, ["-list-avds"]);
  const names = output.split(/\r?\n/).map((name) => name.trim()).filter((name) => safeAvdName(name));
  const running = await listRunningAvds();
  return Promise.all(names.map(async (name) => {
    const { ini, config } = await readAvdConfig(name);
    const apiLevel = apiFromConfig(config, ini);
    const width = config["hw.lcd.width"];
    const height = config["hw.lcd.height"];
    const ram = config["hw.ramSize"];
    const catalogDeviceId = ini["aem.catalog.device.id"];
    const imageMetadata = await avdSystemImageMetadata(config);
    const systemImageVendor = ini["aem.system.image.vendor"] || imageMetadata.vendorId;
    const systemImageFlavor = ini["aem.system.image.flavor"] || imageMetadata.osFlavor;
    const displayName = ini["avd.ini.displayname"] || config["avd.ini.displayname"] || name;
    const serial = running.get(name);
    const child = runningProcesses.get(name);
    const starting = Boolean(child && child.exitCode === null);
    const gpu = config["hw.gpu.mode"];
    return {
      name,
      displayName,
      status: serial ? "running" as const : starting ? "starting" as const : "stopped" as const,
      catalogDeviceId,
      compatible: ini["aem.catalog.compatible"] === "true",
      systemImageVendor,
      systemImageFlavor,
      serial,
      deviceName: config["hw.device.name"],
      manufacturer: config["hw.device.manufacturer"],
      resolution: width && height ? `${width} × ${height}` : undefined,
      screenSize: avdScreenSize(config),
      ram: ram ? `${ram} MB` : undefined,
      androidVersion: apiLevel ? `API ${apiLevel} system image` : undefined,
      apiLevel,
      graphics: graphicsModes.includes(gpu as GraphicsMode) ? gpu as GraphicsMode : undefined
    };
  }));
}

async function listSystemImages(): Promise<SystemImage[]> {
  const sdkPath = sdkStatus?.sdkPath;
  if (!sdkPath) throw new Error("Android SDK path is not available.");
  const root = path.join(sdkPath, "system-images");
  const images: SystemImage[] = [];
  let apis: string[];
  try {
    apis = await fs.readdir(root);
  } catch {
    return images;
  }
  for (const api of apis) {
    const apiPath = path.join(root, api);
    const tags = await fs.readdir(apiPath, { withFileTypes: true }).catch(() => []);
    for (const tag of tags.filter((entry) => entry.isDirectory())) {
      const tagPath = path.join(apiPath, tag.name);
      const abis = await fs.readdir(tagPath, { withFileTypes: true }).catch(() => []);
      for (const abi of abis.filter((entry) => entry.isDirectory())) {
        const packagePath = `system-images;${api};${tag.name};${abi.name}`;
        const apiLevel = api.match(/(\d+)/)?.[1] ?? api;
        const source = parseConfig(await fs.readFile(path.join(tagPath, abi.name, "source.properties"), "utf8").catch(() => ""));
        const osFlavor = osFlavorFromMetadata(source);
        images.push({
          packagePath,
          label: `API ${apiLevel} · ${source["Pkg.Desc"] ?? tag.name.replaceAll("_", " ")} · ${abi.name}`,
          apiLevel,
          abi: abi.name,
          vendorId: source["Addon.VendorId"]?.toLowerCase(),
          osFlavor
        });
      }
    }
  }
  return images.sort((a, b) => Number(b.apiLevel) - Number(a.apiLevel) || a.label.localeCompare(b.label));
}

async function listDeviceProfiles(): Promise<DeviceProfile[]> {
  const executable = requireTool("avdmanagerPath");
  const output = await runJavaTool(executable, ["list", "device"], 30_000);
  const profiles: DeviceProfile[] = [];
  let current: Partial<DeviceProfile> = {};
  const flush = () => {
    if (current.id && current.name) profiles.push(current as DeviceProfile);
    current = {};
  };
  for (const line of output.split(/\r?\n/)) {
    const id = line.match(/^\s*id:\s*\d+\s+or\s+"([^"]+)"/);
    if (id) {
      flush();
      current.id = id[1];
      continue;
    }
    const name = line.match(/^\s*Name:\s*(.+)$/);
    const manufacturer = line.match(/^\s*OEM:\s*(.+)$/);
    if (name) current.name = name[1].trim();
    if (manufacturer) current.manufacturer = manufacturer[1].trim();
  }
  flush();
  return profiles;
}

async function listConnectedDevices(): Promise<ConnectedDevice[]> {
  const output = await run(requireTool("adbPath"), ["devices", "-l"]);
  const devices: ConnectedDevice[] = [];
  for (const line of output.split(/\r?\n/).slice(1)) {
    const match = line.trim().match(/^(\S+)\s+(\S+)(.*)$/);
    if (!match || match[1] === "List") continue;
    const model = match[3].match(/\bmodel:(\S+)/)?.[1]?.replaceAll("_", " ");
    const avdName = match[3].match(/\bavd:(\S+)/)?.[1];
    const isEmulator = match[1].startsWith("emulator-");
    const serial = match[1];
    const [manufacturer, deviceModel, androidVersion] = isEmulator
      ? ["Google", model, undefined]
      : match[2] === "device"
        ? await Promise.all([
          run(requireTool("adbPath"), ["-s", serial, "shell", "getprop", "ro.product.manufacturer"]).catch(() => ""),
          run(requireTool("adbPath"), ["-s", serial, "shell", "getprop", "ro.product.model"]).catch(() => ""),
          run(requireTool("adbPath"), ["-s", serial, "shell", "getprop", "ro.build.version.release"]).catch(() => "")
        ])
        : ["", model, undefined];
    devices.push({
      serial,
      state: match[2],
      model: deviceModel?.trim() || model,
      manufacturer: manufacturer?.trim() || undefined,
      androidVersion: androidVersion?.trim() || undefined,
      avdName,
      isEmulator
    });
  }
  return devices;
}

function validatePhysicalSerial(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value) || value.startsWith("emulator-")) {
    throw new Error("Select a connected physical Android phone.");
  }
  return value;
}

async function requireConnectedPhone(serial: string): Promise<void> {
  const devices = await listConnectedDevices();
  if (!devices.some((device) => device.serial === serial && device.state === "device" && !device.isEmulator)) {
    throw new Error(`Phone ${serial} is not connected and authorized. Connect it and accept the USB debugging prompt.`);
  }
}

async function selectApk(): Promise<ApkSelection | undefined> {
  const options: OpenDialogOptions = {
    title: "Select an Android APK to install",
    properties: ["openFile"],
    filters: [{ name: "Android application", extensions: ["apk"] }]
  } as const;
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return undefined;
  const apkPath = result.filePaths[0];
  if (path.extname(apkPath).toLowerCase() !== ".apk") throw new Error("Select a valid .apk file.");
  const id = randomUUID();
  apkSelections.clear();
  apkSelections.set(id, apkPath);
  return { id, name: path.basename(apkPath) };
}

async function installApk(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Select an APK and a phone first.");
  const options = value as { serial?: unknown; selectionId?: unknown };
  const serial = validatePhysicalSerial(options.serial);
  if (typeof options.selectionId !== "string") throw new Error("Select an APK file first.");
  const apkPath = apkSelections.get(options.selectionId);
  if (!apkPath) throw new Error("The APK selection expired. Select the APK file again.");
  await requireConnectedPhone(serial);
  log("info", `Installing ${path.basename(apkPath)} on ${serial}...`);
  const output = await run(requireTool("adbPath"), ["-s", serial, "install", "-r", apkPath], 180_000);
  apkSelections.delete(options.selectionId);
  log("success", output.trim() || `Installed ${path.basename(apkPath)} on ${serial}.`);
}

async function launchPackage(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Select a phone and enter an app package name.");
  const options = value as { serial?: unknown; packageName?: unknown };
  const serial = validatePhysicalSerial(options.serial);
  if (typeof options.packageName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(options.packageName)) {
    throw new Error("Enter a valid Android package name, for example com.example.myapp.");
  }
  await requireConnectedPhone(serial);
  const output = await run(requireTool("adbPath"), ["-s", serial, "shell", "monkey", "-p", options.packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
  if (/no activities found to run|monkey aborted/i.test(output)) {
    throw new Error(`No launchable activity was found for ${options.packageName} on ${serial}.`);
  }
  log("success", `Launched ${options.packageName} on ${serial}.`);
}

async function mirrorDevice(value: unknown): Promise<void> {
  const serial = validatePhysicalSerial(value);
  await requireConnectedPhone(serial);
  const executable = sdkStatus?.scrcpyPath ?? await findOnPath("scrcpy");
  if (!executable) {
    throw new Error("scrcpy is not installed. Install scrcpy locally, restart the manager, then use Mirror screen.");
  }
  const existing = mirrorProcesses.get(serial);
  if (existing && existing.exitCode === null) {
    log("info", `A screen mirror is already open for ${serial}.`);
    return;
  }
  const child = spawn(executable, ["--serial", serial], {
    shell: false,
    windowsHide: true,
    stdio: "ignore"
  });
  mirrorProcesses.set(serial, child);
  child.once("error", (error) => {
    mirrorProcesses.delete(serial);
    log("error", `Could not start scrcpy: ${error.message}`);
  });
  child.once("exit", () => mirrorProcesses.delete(serial));
  child.unref();
  log("success", `Opened a local screen mirror for ${serial}.`);
}

function validateLaunchOptions(value: unknown): LaunchOptions {
  if (!value || typeof value !== "object") throw new Error("Invalid emulator launch request.");
  const options = value as Partial<LaunchOptions>;
  if (!options.device || typeof options.device.id !== "string" || typeof options.device.name !== "string") {
    throw new Error("Select a device before launching.");
  }
  if (typeof options.avdName !== "string" || !safeAvdName(options.avdName)) {
    throw new Error("Choose a valid AVD name.");
  }
  if (!orientations.includes(options.orientation as Orientation)) throw new Error("Choose a supported orientation.");
  if (!graphicsModes.includes(options.graphics as GraphicsMode)) throw new Error("Choose a supported graphics mode.");
  if (typeof options.charging !== "boolean") throw new Error("Choose whether the emulator should be charging.");
  options.proxy = validateEmulatorProxy(options.proxy);
  return options as LaunchOptions;
}

function validateEmulatorProxy(value: unknown): EmulatorProxy {
  if (!value || typeof value !== "object") throw new Error("Choose a valid emulator proxy configuration.");
  const proxy = value as Partial<EmulatorProxy>;
  if (proxy.mode === "none") {
    return { mode: "none" };
  } else if (proxy.mode === "http" || proxy.mode === "socks5") {
    if (typeof proxy.host !== "string" || !isValidProxyHost(proxy.host)) {
      throw new Error("Enter a valid proxy host name or IP address.");
    }
    if (typeof proxy.port !== "number" || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
      throw new Error("Proxy port must be a whole number between 1 and 65535.");
    }
    if ((proxy.username === undefined) !== (proxy.password === undefined)) {
      throw new Error("Enter both a proxy username and password, or leave both blank.");
    }
    if (proxy.username !== undefined && (
      typeof proxy.username !== "string" ||
      typeof proxy.password !== "string" ||
      !proxy.username ||
      proxy.username.length > 255 ||
      proxy.password.length > 255 ||
      /[\r\n:]/.test(proxy.username) ||
      /[\r\n]/.test(proxy.password)
    )) {
      throw new Error("Proxy credentials are invalid. Usernames and passwords must be 1–255 characters and cannot contain line breaks.");
    }
    return {
      mode: proxy.mode,
      host: proxy.host.trim().replace(/^\[|\]$/g, ""),
      port: proxy.port,
      ...(proxy.username !== undefined && proxy.password !== undefined
        ? { username: proxy.username, password: proxy.password }
        : {})
    };
  }
  throw new Error("Choose No proxy, HTTP/HTTPS, or SOCKS5.");
}

function isValidProxyHost(value: string): boolean {
  const host = value.trim().replace(/^\[|\]$/g, "");
  if (!host || host.length > 253 || /[\s/@?#]/.test(host)) return false;
  return isIP(host) !== 0 || /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*\.?$/.test(host);
}

function catalogVendorFromId(id: string): string | undefined {
  if (id.startsWith("pixel-")) return "google";
  if (id.startsWith("galaxy-")) return "samsung";
  if (id.startsWith("oneplus-")) return "oneplus";
  if (id.startsWith("xiaomi-")) return "xiaomi";
  return undefined;
}

async function applyOrientation(serial: string, orientation: Orientation): Promise<void> {
  if (!/^emulator-\d+$/.test(serial)) throw new Error("Invalid emulator serial.");
  const rotation = orientation === "Landscape" ? "1" : "0";
  await run(requireTool("adbPath"), ["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  await run(requireTool("adbPath"), ["-s", serial, "shell", "settings", "put", "system", "user_rotation", rotation]);
}

async function applyChargingState(serial: string, charging: boolean): Promise<void> {
  if (!/^emulator-\d+$/.test(serial)) throw new Error("Invalid emulator serial.");
  await run(requireTool("adbPath"), ["-s", serial, "emu", "power", "ac", charging ? "on" : "off"]);
}

async function setCharging(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Invalid charging-state request.");
  const options = value as { avdName?: unknown; charging?: unknown };
  if (typeof options.avdName !== "string" || !safeAvdName(options.avdName)) {
    throw new Error("Choose a valid AVD name.");
  }
  if (typeof options.charging !== "boolean") throw new Error("Choose whether the emulator should be charging.");
  const serial = (await listRunningAvds()).get(options.avdName);
  if (!serial) throw new Error(`${options.avdName} is not running.`);
  await applyChargingState(serial, options.charging);
  log("success", `${options.avdName} AC power ${options.charging ? "connected" : "disconnected"}.`);
}

async function setEmulatorLocation(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Invalid emulator location request.");
  const options = value as { avdName?: unknown; latitude?: unknown; longitude?: unknown };
  if (typeof options.avdName !== "string" || !safeAvdName(options.avdName)) {
    throw new Error("Choose a valid AVD name.");
  }
  if (typeof options.latitude !== "number" || !Number.isFinite(options.latitude) || options.latitude < -90 || options.latitude > 90) {
    throw new Error("Latitude must be between -90 and 90 degrees.");
  }
  if (typeof options.longitude !== "number" || !Number.isFinite(options.longitude) || options.longitude < -180 || options.longitude > 180) {
    throw new Error("Longitude must be between -180 and 180 degrees.");
  }
  const serial = (await listRunningAvds()).get(options.avdName);
  if (!serial) throw new Error(`${options.avdName} is not running.`);
  await run(requireTool("adbPath"), [
    "-s", serial, "emu", "geo", "fix",
    String(options.longitude), String(options.latitude)
  ]);
  log("success", `${options.avdName} emulator location updated.`);
}

async function launch(options: LaunchOptions): Promise<void> {
  const avds = await listAvds();
  const selectedAvd = avds.find((avd) => avd.name === options.avdName);
  if (!selectedAvd) {
    throw new Error(`AVD "${options.avdName}" is not installed. Create it from an available device profile and system image first.`);
  }
  const expectedVendor = catalogVendorFromId(options.device.id);
  const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (expectedVendor && (
    selectedAvd.systemImageVendor !== expectedVendor ||
    (expectedVendor === "samsung" && selectedAvd.systemImageFlavor !== "oneui") ||
    (expectedVendor === "xiaomi" && selectedAvd.systemImageFlavor !== "hyperos") ||
    (expectedVendor === "oneplus" && selectedAvd.systemImageFlavor !== "oxygenos") ||
    (expectedVendor === "google" && selectedAvd.systemImageFlavor !== "android") ||
    selectedAvd.compatible === true ||
    !selectedAvd.manufacturer?.toLowerCase().includes(expectedVendor) ||
    ![selectedAvd.displayName, selectedAvd.deviceName].some((name) => typeof name === "string" && normalizeName(name) === normalizeName(options.device.name))
  )) {
    throw new Error(`Refusing to launch ${selectedAvd.displayName}: its hardware profile and system image are not both identified as the selected manufacturer's device and OS.`);
  }
  const running = await listRunningAvds();
  const currentSerial = running.get(options.avdName);
  if (currentSerial) {
    if (options.proxy.mode !== "none") {
      throw new Error("Proxy settings apply only when an emulator starts. Stop this AVD, then open it again to apply the selected proxy.");
    }
    await applyOrientation(currentSerial, options.orientation);
    await applyChargingState(currentSerial, options.charging);
    log("info", `${options.avdName} is already running; applied ${options.orientation.toLowerCase()} orientation and ${options.charging ? "enabled" : "disabled"} AC charging.`);
    return;
  }
  const activeProcess = runningProcesses.get(options.avdName);
  if (activeProcess && activeProcess.exitCode === null) {
    log("info", `${options.avdName} is already starting.`);
    return;
  }
  const executable = requireTool("emulatorPath");
  const args = ["-avd", options.avdName, "-gpu", options.graphics];
  if (options.proxy.mode !== "none") {
    const bridge = await createEmulatorProxyBridge(options.proxy);
    socksBridges.set(options.avdName, bridge);
    args.push("-http-proxy", `http://127.0.0.1:${bridge.port}`);
  }
  let child: ChildProcess;
  try {
    child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: "ignore"
    });
  } catch (error) {
    socksBridges.get(options.avdName)?.close();
    socksBridges.delete(options.avdName);
    throw error;
  }
  runningProcesses.set(options.avdName, child);
  let launchFailure: string | undefined;
  child.once("error", (error) => {
    launchFailure = `Emulator failed to start: ${error.message}`;
    runningProcesses.delete(options.avdName);
    socksBridges.get(options.avdName)?.close();
    socksBridges.delete(options.avdName);
    log("error", launchFailure);
  });
  child.once("exit", (code) => {
    runningProcesses.delete(options.avdName);
    socksBridges.get(options.avdName)?.close();
    socksBridges.delete(options.avdName);
    if (code !== 0) launchFailure = `${options.avdName} emulator process exited${code === null ? "" : ` with exit code ${code}`}.`;
    log(code === 0 ? "info" : "error", code === 0 ? `${options.avdName} stopped.` : launchFailure ?? `${options.avdName} emulator process exited unexpectedly.`);
  });
  child.unref();
  log("info", `Starting ${options.avdName} with ${options.graphics} graphics...`);
  const startedAt = Date.now();
  let serial: string | undefined;
  while (Date.now() - startedAt < 30_000 && !serial && !launchFailure) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    serial = (await listRunningAvds()).get(options.avdName);
  }
  if (!serial) {
    if (launchFailure) throw new Error(launchFailure);
    log("warning", `${options.avdName} is still starting. Refresh devices to check its status.`);
    return;
  }
  try {
    await applyOrientation(serial, options.orientation);
  } catch (error) {
    log("warning", `Emulator started, but orientation could not be applied yet: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await applyChargingState(serial, options.charging);
  } catch (error) {
    log("warning", `Emulator started, but AC charging could not be changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  log("success", `${options.device.name} is running as ${serial}.`);
}

async function stop(avdName: string): Promise<void> {
  if (!safeAvdName(avdName)) throw new Error("Choose a valid AVD name.");
  const serial = (await listRunningAvds()).get(avdName);
  const startingProcess = runningProcesses.get(avdName);
  if (serial) {
    await run(requireTool("adbPath"), ["-s", serial, "emu", "kill"]);
  } else if (startingProcess && startingProcess.exitCode === null) {
    startingProcess.kill();
  } else {
    throw new Error(`${avdName} is not running.`);
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000 &&
    ((await listRunningAvds()).has(avdName) || runningProcesses.get(avdName)?.exitCode === null)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if ((await listRunningAvds()).has(avdName) || runningProcesses.get(avdName)?.exitCode === null) {
    throw new Error(`${avdName} did not stop within 15 seconds.`);
  }
  log("success", `${avdName} stopped.`);
}

async function createAvd(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Invalid AVD creation request.");
  const options = value as Partial<CreateAvdOptions>;
  if (typeof options.name !== "string" || !safeAvdName(options.name)) {
    throw new Error("AVD name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.");
  }
  if (typeof options.deviceId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(options.deviceId)) {
    throw new Error("Choose a device profile from the available SDK profiles.");
  }
  if (typeof options.systemImage !== "string" || !/^system-images;[A-Za-z0-9._;-]+$/.test(options.systemImage)) {
    throw new Error("Choose an installed Android system image.");
  }
  if (options.catalogDeviceId !== undefined && (typeof options.catalogDeviceId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(options.catalogDeviceId))) {
    throw new Error("Invalid catalog device identifier.");
  }
  if (options.catalogDeviceName !== undefined && (
    typeof options.catalogDeviceName !== "string" ||
    options.catalogDeviceName.length > 100 ||
    /[\r\n=]/.test(options.catalogDeviceName)
  )) {
    throw new Error("Invalid catalog device display name.");
  }
  if (options.catalogDeviceBrand !== undefined && (
    typeof options.catalogDeviceBrand !== "string" ||
    !/^(Google Pixel|Samsung Galaxy|OnePlus|Xiaomi)$/.test(options.catalogDeviceBrand)
  )) {
    throw new Error("Invalid catalog device brand.");
  }
  const hasCatalogMetadata = options.catalogDeviceId !== undefined ||
    options.catalogDeviceName !== undefined ||
    options.catalogDeviceBrand !== undefined;
  if (hasCatalogMetadata && (!options.catalogDeviceId || !options.catalogDeviceName || !options.catalogDeviceBrand)) {
    throw new Error("Catalog AVD creation requires a device ID, model name, and manufacturer.");
  }
  const [profiles, images] = await Promise.all([listDeviceProfiles(), listSystemImages()]);
  const profile = profiles.find((item) => item.id === options.deviceId);
  if (!profile) throw new Error("That device profile is no longer available.");
  const image = images.find((item) => item.packagePath === options.systemImage);
  if (!image) throw new Error("That system image is not installed.");
  if (options.catalogDeviceName && options.catalogDeviceBrand) {
    const expectedVendor = vendorForBrand(options.catalogDeviceBrand);
    if (!profileMatchesCatalogDevice(profile, options.catalogDeviceName, expectedVendor)) {
      throw new Error(`No exact ${options.catalogDeviceBrand} hardware profile is selected. A different manufacturer's profile cannot be used.`);
    }
    if (!systemImageMatchesBrand(image, options.catalogDeviceBrand)) {
      throw new Error(`The selected image metadata does not identify the required ${options.catalogDeviceBrand} OS. Install a supported official vendor OS image before creating this AVD.`);
    }
  }
  const names = await run(requireTool("emulatorPath"), ["-list-avds"]);
  if (names.split(/\r?\n/).some((name) => name.trim() === options.name)) {
    throw new Error(`An AVD named "${options.name}" already exists.`);
  }
  const executable = requireTool("avdmanagerPath");
  await runJavaTool(executable, [
    "create", "avd", "-n", options.name, "-k", options.systemImage, "-d", options.deviceId, "--force"
  ], 120_000);
  if (options.catalogDeviceId && options.catalogDeviceName && options.catalogDeviceBrand) {
    const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const metadata = [
      `aem.catalog.device.id=${options.catalogDeviceId}`,
      "aem.catalog.compatible=false",
      `aem.system.image.vendor=${image.vendorId ?? ""}`,
      `aem.system.image.flavor=${image.osFlavor ?? ""}`,
      `avd.ini.displayname=${options.catalogDeviceName}`
    ].join("\n");
    const iniPath = path.join(avdDirectory(), `${options.name}.ini`);
    await fs.appendFile(iniPath, `\n${metadata}\n`, "utf8");
  }
  log("success", `Created AVD "${options.name}".`);
}

function vendorForBrand(brand: string): string {
  switch (brand) {
    case "Google Pixel": return "google";
    case "Samsung Galaxy": return "samsung";
    case "OnePlus": return "oneplus";
    case "Xiaomi": return "xiaomi";
    default: return "";
  }
}

function profileMatchesCatalogDevice(profile: DeviceProfile, name: string, vendor: string): boolean {
  const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const expectedName = normalizeName(name);
  return (normalizeName(profile.name) === expectedName || normalizeName(profile.id) === expectedName) &&
    Boolean(profile.manufacturer?.toLowerCase().includes(vendor));
}

function registerIpc(): void {
  ipcMain.handle("external:samsung-rtl", async () => {
    await shell.openExternal("https://developer.samsung.com/remote-test-lab");
  });
  ipcMain.handle("phone:select-apk", async () => selectApk());
  ipcMain.handle("phone:install-apk", async (_event, value: unknown) => installApk(value));
  ipcMain.handle("phone:launch-package", async (_event, value: unknown) => launchPackage(value));
  ipcMain.handle("phone:mirror", async (_event, value: unknown) => mirrorDevice(value));
  ipcMain.handle("sdk:status", async () => getSdk());
  ipcMain.handle("avd:list", async () => listAvds());
  ipcMain.handle("adb:devices", async () => listConnectedDevices());
  ipcMain.handle("sdk:images", async () => listSystemImages());
  ipcMain.handle("sdk:profiles", async () => listDeviceProfiles());
  ipcMain.handle("emulator:launch", async (_event, value: unknown) => {
    await launch(validateLaunchOptions(value));
  });
  ipcMain.handle("emulator:proxy-test", async (_event, value: unknown) => {
    const proxy = validateEmulatorProxy(value);
    if (proxy.mode === "none") throw new Error("Choose HTTP proxy or SOCKS5 and enter its server details first.");
    await testEmulatorProxyConnection(proxy);
    log("success", "Proxy connection and HTTPS tunnel test passed.");
  });
  ipcMain.handle("emulator:location", async (_event, value: unknown) => setEmulatorLocation(value));
  ipcMain.handle("emulator:charging", async (_event, value: unknown) => setCharging(value));
  ipcMain.handle("emulator:stop", async (_event, value: unknown) => {
    if (typeof value !== "string") throw new Error("Invalid AVD name.");
    await stop(value);
  });
  ipcMain.handle("avd:create", async (_event, value: unknown) => createAvd(value));
}

app.on("before-quit", () => {
  for (const bridge of socksBridges.values()) bridge.close();
  socksBridges.clear();
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#111318",
    title: "Android Emulator Manager",
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const destination = new URL(url);
      if (destination.origin === "https://developer.samsung.com" && destination.pathname === "/remote-test-lab") {
        void shell.openExternal(destination.toString());
      }
    } catch (error) {
      log("warning", `Blocked invalid external link: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { action: "deny" };
  });
  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged ? url.startsWith("file://") : url.startsWith("http://127.0.0.1:5173/");
    if (!allowed) event.preventDefault();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  registerIpc();
  await getSdk();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
