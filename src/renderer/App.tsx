import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeftRight, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Code2, Cpu, Database, ExternalLink, Heart, LayoutDashboard, LoaderCircle, MemoryStick,
  Monitor, MoreHorizontal, Play, Plus, RefreshCw, RotateCw, Search, Settings2, Smartphone,
  Sparkles, Terminal, Trash2, Usb, X, Cloud
} from "lucide-react";
import type {
  ApkSelection, AvdInfo, ConnectedDevice, DeviceProfile, EmulatorLog, GraphicsMode, Orientation, SdkStatus, SystemImage
} from "../electron/shared";
import { brands, devices, type CatalogDevice } from "./devices";
import { PhoneArt } from "./PhoneArt";

type Page = "dashboard" | "avds" | "phones" | "remote" | "logs";
const graphicsOptions: { value: GraphicsMode; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "host", label: "Hardware accelerated" },
  { value: "swiftshader_indirect", label: "Software (SwiftShader)" },
  { value: "angle_indirect", label: "ANGLE" },
  { value: "guest", label: "Guest renderer" }
];

function readStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");
}

function vendorForDevice(device: CatalogDevice): string {
  switch (device.brand) {
    case "Google Pixel": return "google";
    case "Samsung Galaxy": return "samsung";
    case "OnePlus": return "oneplus";
    case "Xiaomi": return "xiaomi";
  }
}

function osFlavorForDevice(device: CatalogDevice): string {
  switch (device.brand) {
    case "Google Pixel": return "android";
    case "Samsung Galaxy": return "oneui";
    case "OnePlus": return "oxygenos";
    case "Xiaomi": return "hyperos";
  }
}

function matchAvd(device: CatalogDevice, avds: AvdInfo[]): AvdInfo | undefined {
  const expected = normalize(device.name);
  const vendor = vendorForDevice(device);
  return avds.find((avd) =>
    avd.systemImageVendor === vendor &&
    avd.systemImageFlavor === osFlavorForDevice(device) &&
    avd.manufacturer?.toLowerCase().includes(vendor) &&
    avd.compatible !== true &&
    [avd.displayName, avd.deviceName].some((value) => value && normalize(value) === expected) &&
    (!avd.catalogDeviceId || avd.catalogDeviceId === device.id)
  );
}

function matchesDeviceProfile(profile: DeviceProfile, device: CatalogDevice): boolean {
  const expected = normalize(device.name);
  return (normalize(profile.name) === expected || normalize(profile.id) === expected) &&
    Boolean(profile.manufacturer?.toLowerCase().includes(vendorForDevice(device)));
}

function nativeProfile(profiles: DeviceProfile[], device: CatalogDevice): DeviceProfile | undefined {
  return profiles.find((profile) => matchesDeviceProfile(profile, device));
}

function nativeSystemImage(images: SystemImage[], device: CatalogDevice): SystemImage | undefined {
  return images.find((image) => image.vendorId === vendorForDevice(device) && image.osFlavor === osFlavorForDevice(device));
}

function systemFlavorName(flavor?: string): string | undefined {
  switch (flavor) {
    case "android": return "Google Android";
    case "oneui": return "Samsung One UI";
    case "hyperos": return "Xiaomi HyperOS";
    case "oxygenos": return "OnePlus OxygenOS";
    default: return undefined;
  }
}

function compatibleAvdName(device: CatalogDevice, apiLevel: string): string {
  const slug = device.id.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `aem_${slug}_api${apiLevel}`;
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [sdk, setSdk] = useState<SdkStatus>({ installed: false, message: "Checking for Android SDK..." });
  const [avds, setAvds] = useState<AvdInfo[]>([]);
  const [connected, setConnected] = useState<ConnectedDevice[]>([]);
  const [selectedPhoneSerial, setSelectedPhoneSerial] = useState("");
  const [apkSelection, setApkSelection] = useState<ApkSelection>();
  const [packageName, setPackageName] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [selected, setSelected] = useState<CatalogDevice | null>(null);
  const [selectedAvd, setSelectedAvd] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("Portrait");
  const [graphics, setGraphics] = useState<GraphicsMode>("auto");
  const [charging, setCharging] = useState(true);
  const [chargingBusy, setChargingBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<(typeof brands)[number]>("All devices");
  const [favorites, setFavorites] = useState<string[]>(() => readStorage("aem-favorites", []));
  const [recent, setRecent] = useState<string[]>(() => readStorage("aem-recent", []));
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [logs, setLogs] = useState<EmulatorLog[]>([]);
  const [launching, setLaunching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [images, setImages] = useState<SystemImage[]>([]);
  const [profileInventoryLoaded, setProfileInventoryLoaded] = useState(false);
  const [loadingCreateOptions, setLoadingCreateOptions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [profileId, setProfileId] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [dragging, setDragging] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((level: EmulatorLog["level"], message: string) => {
    setLogs((current) => [{ timestamp: new Date().toISOString(), level, message }, ...current].slice(0, 100));
  }, []);

  async function openSamsungRemoteTestLab() {
    try {
      if (window.emulatorManager) {
        await window.emulatorManager.openSamsungRemoteTestLab();
      } else {
        window.open("https://developer.samsung.com/remote-test-lab", "_blank", "noopener,noreferrer");
      }
      addLog("info", "Opened Samsung Remote Test Lab. Sign in and select an available Galaxy device on Samsung's site.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    }
  }

  async function chooseApkFile() {
    try {
      const selection = await window.emulatorManager.selectApk();
      if (selection) setApkSelection(selection);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    }
  }

  async function installSelectedApk() {
    if (!selectedPhoneSerial || !apkSelection) return;
    setPhoneBusy(true);
    setError("");
    try {
      await window.emulatorManager.installApk(selectedPhoneSerial, apkSelection.id);
      addLog("success", `Installed ${apkSelection.name} on ${selectedPhoneSerial}.`);
      setApkSelection(undefined);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function launchPhonePackage() {
    if (!selectedPhoneSerial || !packageName) return;
    setPhoneBusy(true);
    setError("");
    try {
      await window.emulatorManager.launchPackage(selectedPhoneSerial, packageName);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function mirrorPhone() {
    if (!selectedPhoneSerial) return;
    setPhoneBusy(true);
    setError("");
    try {
      await window.emulatorManager.mirrorDevice(selectedPhoneSerial);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setPhoneBusy(false);
    }
  }

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    setError("");
    try {
      if (!window.emulatorManager) {
        const message = "Open this dashboard in the Android Emulator Manager desktop app to connect to the Android SDK.";
        setSdk({ installed: false, message });
        setError(message);
        return;
      }
      const currentSdk = await window.emulatorManager.getSdkStatus();
      setSdk(currentSdk);
      if (!currentSdk.installed) {
        setAvds([]);
        setConnected([]);
        if (!silent) addLog("warning", currentSdk.message);
        return;
      }
      const [nextAvds, nextConnected, nextProfiles, nextImages] = await Promise.all([
        window.emulatorManager.listAvds(),
        window.emulatorManager.listConnectedDevices(),
        currentSdk.avdmanagerPath ? window.emulatorManager.listDeviceProfiles() : Promise.resolve([]),
        window.emulatorManager.listSystemImages()
      ]);
      setAvds(nextAvds);
      setConnected(nextConnected);
      setProfiles(nextProfiles);
      setImages(nextImages);
      setProfileInventoryLoaded(true);
      setSelectedAvd((current) => current && nextAvds.some((avd) => avd.name === current) ? current : "");
      setSelectedPhoneSerial((current) =>
        current && nextConnected.some((device) => device.serial === current && !device.isEmulator)
          ? current
          : nextConnected.find((device) => device.state === "device" && !device.isEmulator)?.serial ?? ""
      );
      if (!silent) addLog("success", `Refreshed Android SDK · ${nextAvds.length} AVD${nextAvds.length === 1 ? "" : "s"} · ${nextConnected.length} connected device${nextConnected.length === 1 ? "" : "s"}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setRefreshing(false);
      setProfileInventoryLoaded(true);
    }
  }, [addLog]);

  useEffect(() => {
    void refresh(true);
    if (!window.emulatorManager) return;
    return window.emulatorManager.onLog((entry) => {
      setLogs((current) => [entry, ...current].slice(0, 100));
      if (entry.level === "error") setError(entry.message);
    });
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem("aem-favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem("aem-recent", JSON.stringify(recent));
  }, [recent]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const matchingAvds = useMemo(() => selected ? avds.filter((avd) => {
    return matchAvd(selected, [avd]) !== undefined;
  }) : [], [avds, selected]);
  const activeAvd = selected ? avds.find((avd) => avd.name === selectedAvd) ?? matchAvd(selected, avds) : undefined;
  const displayedDevices = useMemo(() => {
    const search = query.trim().toLowerCase();
    return devices.filter((device) =>
      (brand === "All devices" || device.brand === brand) &&
      (!onlyFavorites || favorites.includes(device.id)) &&
      (!search || device.name.toLowerCase().includes(search) || device.brand.toLowerCase().includes(search))
    );
  }, [brand, favorites, onlyFavorites, query]);
  const runningCount = avds.filter((avd) => avd.status === "running").length;
  const emulatorStarting = launching || activeAvd?.status === "starting";
  const recentDevices = recent.map((id) => devices.find((device) => device.id === id)).filter((device): device is CatalogDevice => Boolean(device));
  const createProfiles = selected ? profiles.filter((profile) => matchesDeviceProfile(profile, selected)) : [];
  const createImages = selected ? images.filter((image) => nativeSystemImage([image], selected) !== undefined) : [];

  function chooseDevice(device: CatalogDevice) {
    setSelected(device);
    const found = matchAvd(device, avds);
    setSelectedAvd(found?.name ?? "");
    setOrientation(found?.orientation ?? "Portrait");
    setGraphics(found?.graphics ?? "auto");
    setError("");
  }

  function toggleFavorite(device: CatalogDevice) {
    setFavorites((current) => current.includes(device.id) ? current.filter((id) => id !== device.id) : [...current, device.id]);
  }

  async function openCreateDialog() {
    if (!selected) {
      setError("Select a phone model before creating an AVD.");
      return;
    }
    setShowCreate(true);
    setLoadingCreateOptions(true);
    setError("");
    try {
      const [allProfiles, allImages] = await Promise.all([
        window.emulatorManager.listDeviceProfiles(),
        window.emulatorManager.listSystemImages()
      ]);
      setProfiles(allProfiles);
      setImages(allImages);
      const profileMatch = nativeProfile(allProfiles, selected);
      const imageMatch = nativeSystemImage(allImages, selected);
      setProfileId(profileMatch?.id ?? "");
      setImagePath(imageMatch?.packagePath ?? "");
      const api = imageMatch?.apiLevel;
      setCreateName(compatibleAvdName(selected, api ?? "latest"));
      if (!profileMatch || !imageMatch) {
        setError(`No exact ${selected.brand} profile and vendor OS image are installed. Install the official ${selected.brand} emulator packages before creating this device.`);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setLoadingCreateOptions(false);
    }
  }

  async function createAvd() {
    if (!createName || !profileId || !imagePath) return;
    setCreating(true);
    setError("");
    try {
      await window.emulatorManager.createAvd({
        name: createName,
        deviceId: profileId,
        systemImage: imagePath,
        catalogDeviceId: selected?.id,
        catalogDeviceName: selected?.name,
        catalogDeviceBrand: selected?.brand
      });
      addLog("success", `Created ${createName}.`);
      setShowCreate(false);
      await refresh(true);
      setSelectedAvd(createName);
      const createdAvd = (await window.emulatorManager.listAvds()).find((avd) => avd.name === createName);
      if (createdAvd && selected) await launchInstalledAvd(createdAvd, selected);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setCreating(false);
    }
  }

  async function launchSelected() {
    if (!selected) {
      setError("Choose a phone model to continue.");
      return;
    }
    if (!sdk.installed) {
      setError(sdk.message);
      return;
    }
    const targetAvd = avds.find((avd) => avd.name === selectedAvd) ?? matchAvd(selected, avds);
    if (!targetAvd) {
      await createCompatibleAndLaunch(selected);
      return;
    }
    await launchInstalledAvd(targetAvd, selected);
  }

  async function createCompatibleAndLaunch(device: CatalogDevice) {
    if (!sdk.avdmanagerPath) {
      setError("Install Android SDK Command-line Tools in Android Studio's SDK Manager to create a native vendor AVD.");
      return;
    }
    setLaunching(true);
    setError("");
    addLog("info", `Preparing a native ${device.brand} emulator for ${device.name}...`);
    try {
      const [availableProfiles, availableImages, installedAvds] = await Promise.all([
        window.emulatorManager.listDeviceProfiles(),
        window.emulatorManager.listSystemImages(),
        window.emulatorManager.listAvds()
      ]);
      const profile = nativeProfile(availableProfiles, device);
      const image = nativeSystemImage(availableImages, device);
      if (!profile || !image) {
        const requiredOs = systemFlavorName(device.brand === "Samsung Galaxy" ? "oneui" : device.brand === "Xiaomi" ? "hyperos" : device.brand === "OnePlus" ? "oxygenos" : "android");
        throw new Error(`No exact ${device.brand} hardware profile and verified ${requiredOs} image are installed. Generic Android or Google Pixel images cannot be used as ${device.brand} OS.`);
      }
      const avdName = compatibleAvdName(device, image.apiLevel);
      let avd = installedAvds.find((item) => item.name === avdName);
      if (!avd) {
        addLog("info", `Creating ${device.name} with the SDK's "${profile.name}" profile and ${image.label} image.`);
        await window.emulatorManager.createAvd({
          name: avdName,
          deviceId: profile.id,
          systemImage: image.packagePath,
          catalogDeviceId: device.id,
          catalogDeviceName: device.name,
          catalogDeviceBrand: device.brand
        });
        const refreshedAvds = await window.emulatorManager.listAvds();
        avd = refreshedAvds.find((item) => item.name === avdName);
      }
      if (!avd) throw new Error(`Created ${avdName}, but the Android Emulator did not report it as an available AVD.`);
      setAvds((current) => current.some((item) => item.name === avd.name)
        ? current.map((item) => item.name === avd.name ? avd : item)
        : [...current, avd]);
      setSelectedAvd(avd.name);
      await window.emulatorManager.launch({
        device: { id: device.id, name: device.name, brand: device.brand },
        avdName: avd.name,
        orientation,
        graphics,
        charging
      });
      setRecent((current) => [device.id, ...current.filter((id) => id !== device.id)].slice(0, 5));
      await refresh(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setLaunching(false);
    }
  }

  async function launchInstalledAvd(avd: AvdInfo, device?: CatalogDevice) {
    setLaunching(true);
    setError("");
    addLog("info", `Preparing ${device?.name ?? avd.displayName}...`);
    try {
      await window.emulatorManager.launch({
        device: {
          id: device?.id ?? avd.name,
          name: device?.name ?? avd.displayName,
          brand: device?.brand ?? avd.manufacturer ?? "Android"
        },
        avdName: avd.name,
        orientation,
        graphics,
        charging
      });
      if (device) setRecent((current) => [device.id, ...current.filter((id) => id !== device.id)].slice(0, 5));
      await refresh(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
    } finally {
      setLaunching(false);
    }
  }

  async function stopAvd(name: string): Promise<boolean> {
    setError("");
    try {
      await window.emulatorManager.stop(name);
      addLog("info", `Stopping ${name}...`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await refresh(true);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      addLog("error", message);
      return false;
    }
  }

  async function updateCharging(charging: boolean) {
    setCharging(charging);
    if (activeAvd?.status !== "running") return;
    setChargingBusy(true);
    setError("");
    try {
      await window.emulatorManager.setCharging(activeAvd.name, charging);
      addLog("success", `${activeAvd.displayName} charging ${charging ? "enabled" : "disabled"}.`);
      await refresh(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setCharging(!charging);
      setError(message);
      addLog("error", message);
    } finally {
      setChargingBusy(false);
    }
  }

  async function restartAvd(avd: AvdInfo) {
    const catalogMatch = devices.find((device) => matchAvd(device, [avd]));
    if (catalogMatch) chooseDevice(catalogMatch);
    setSelectedAvd(avd.name);
    if (avd.status !== "stopped" && !(await stopAvd(avd.name))) return;
    await launchInstalledAvd(avd, catalogMatch);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const device = devices.find((item) => item.id === event.dataTransfer.getData("text/device-id"));
    if (device) chooseDevice(device);
  }

  const renderCatalogCard = (device: CatalogDevice) => {
    const avd = matchAvd(device, avds);
    const unavailable = profileInventoryLoaded && !avd && (!nativeProfile(profiles, device) || !nativeSystemImage(images, device));
    return (
      <div
        className={`device-card${selected?.id === device.id ? " selected" : ""}${unavailable ? " unavailable" : ""}`}
        key={device.id}
        role="button"
        tabIndex={unavailable ? -1 : 0}
        draggable={!unavailable}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/device-id", device.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onKeyDown={(event) => {
          if (!unavailable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            chooseDevice(device);
          }
        }}
        onClick={() => { if (!unavailable) chooseDevice(device); }}
        aria-disabled={unavailable}
        aria-pressed={selected?.id === device.id}
        title={`Select ${device.name}`}
      >
        <button className="card-heart" onClick={(event) => { event.stopPropagation(); toggleFavorite(device); }} aria-label={favorites.includes(device.id) ? "Remove favorite" : "Add favorite"}>
          <Heart size={14} fill={favorites.includes(device.id) ? "currentColor" : "none"} />
        </button>
        <PhoneArt device={device} />
        <span className="device-card-name">{device.name}</span>
        <span className="device-card-brand">{device.brand}</span>
        {avd ? <span className="card-avd"><span /> {systemFlavorName(avd.systemImageFlavor)} AVD</span>
          : unavailable ? <span className="card-os-unavailable">Native vendor OS unavailable</span>
            : profileInventoryLoaded && <span className="card-avd"><span /> Native OS ready to create</span>}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Smartphone size={20} strokeWidth={2.2} /></div>
          <div><strong>Android Emulator</strong><span>DEVICE MANAGER</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={page === "dashboard" ? "nav-item active" : "nav-item"} onClick={() => setPage("dashboard")}><LayoutDashboard size={17} /> Overview</button>
          <button className={page === "avds" ? "nav-item active" : "nav-item"} onClick={() => setPage("avds")}><Smartphone size={17} /> My virtual devices <span className="nav-count">{avds.length}</span></button>
          <button className={page === "phones" ? "nav-item active" : "nav-item"} onClick={() => setPage("phones")}><Usb size={17} /> Local phones</button>
          <button className={page === "remote" ? "nav-item active" : "nav-item"} onClick={() => setPage("remote")}><Cloud size={17} /> Remote devices</button>
          <button className={page === "logs" ? "nav-item active" : "nav-item"} onClick={() => setPage("logs")}><Terminal size={17} /> Logs & diagnostics</button>
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-heading">QUICK INFO</div>
        <div className="quick-info">
          <div className="quick-icon"><Database size={15} /></div>
          <div><span>Android SDK</span><strong className={sdk.installed ? "text-green" : "text-muted"}>{sdk.installed ? "Connected" : "Not detected"}</strong></div>
          <span className={sdk.installed ? "status-dot good" : "status-dot"} />
        </div>
        <div className="quick-info">
          <div className="quick-icon"><Activity size={15} /></div>
          <div><span>Active emulators</span><strong>{runningCount} running</strong></div>
        </div>
        <div className="sidebar-bottom">
          <div className="vscode-card">
            <div className="vscode-icon"><Code2 size={17} /></div>
            <div><strong>Made for your workflow</strong><span>Launch Android emulators right from your desktop.</span></div>
          </div>
          <div className="profile-row"><div className="profile-avatar">A</div><div><strong>Local workspace</strong><span>VS Code companion</span></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{page === "dashboard" ? "Overview" : page === "avds" ? "My virtual devices" : page === "phones" ? "Local phones" : page === "remote" ? "Remote devices" : "Logs & diagnostics"}</strong></div>
          <div className="topbar-actions">
            <span className="connection-state"><span className={sdk.installed ? "status-dot good" : "status-dot"} /> {sdk.installed ? "SDK connected" : "SDK offline"}</span>
            <button className="icon-button" title="Refresh SDK and devices" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            </button>
            <div className="topbar-avatar">A</div>
          </div>
        </header>

        <div className="page-scroll">
          {page === "dashboard" && (
            <div className="dashboard-page">
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><Sparkles size={13} /> YOUR ANDROID WORKSPACE</div>
                  <h1>Device <span>lab.</span></h1>
                  <p>Choose a device, configure your emulator, and get building.</p>
                </div>
                <div className="welcome-actions">
                  <div className="search-box"><Search size={16} /><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search device models..." aria-label="Search phone models" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}<kbd>⌘ K</kbd></div>
                  <button className="secondary-button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh</button>
                </div>
              </section>

              {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}

              <section className="selection-config">
                <div
                  className={`selection-zone${dragging ? " drag-over" : ""}${selected ? " has-device" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <div className="zone-head"><span className="step-count">01</span><div><h2>Select Your Android Device</h2><p>Choose a model below, or drag it into this space.</p></div><div className="drop-indicator"><ArrowDownToLine size={15} /> DROP TO SELECT</div></div>
                  {selected ? (
                    <div className="selected-device">
                      <div className="selected-art"><PhoneArt device={selected} large /></div>
                      <div className="selected-copy"><span className="selected-brand">{selected.brand}</span><h3>{selected.name}</h3>
                        <div className={`avd-match${activeAvd ? " available" : ""}`}><span className="status-dot" />{activeAvd ? `${activeAvd.displayName} · ${activeAvd.status === "running" ? "Running" : activeAvd.status === "starting" ? "Starting" : "Ready to launch"}` : profileInventoryLoaded && (!nativeProfile(profiles, selected) || !nativeSystemImage(images, selected)) ? `${selected.brand} OS isn't available in the detected SDK` : "No native AVD yet · Create with the installed vendor profile and OS"}</div>
                        <div className="selection-buttons">
                          <button className="primary-button" onClick={() => void launchSelected()} disabled={emulatorStarting || !sdk.installed || (profileInventoryLoaded && !activeAvd && (!nativeProfile(profiles, selected) || !nativeSystemImage(images, selected)))}>
                            {emulatorStarting ? <><LoaderCircle size={16} className="spin" /> PREPARING DEVICE</> : <><Play size={15} fill="currentColor" /> {activeAvd ? "OPEN EMULATOR" : "CREATE & OPEN"}</>}
                          </button>
                          {!activeAvd && !profileInventoryLoaded && <button className="text-button" onClick={() => void openCreateDialog()}><Plus size={15} /> Create AVD</button>}
                          {!activeAvd && profileInventoryLoaded && nativeProfile(profiles, selected) && nativeSystemImage(images, selected) && <button className="text-button" onClick={() => void openCreateDialog()}><Plus size={15} /> Create AVD</button>}
                          <button className="text-button quiet" onClick={() => { setSelected(null); setSelectedAvd(""); }}><X size={14} /> Clear</button>
                        </div>
                      </div>
                      <button className="replace-chip" onClick={() => { setSelected(null); setSelectedAvd(""); }}><ArrowLeftRight size={14} /> Replace</button>
                    </div>
                  ) : (
                    <div className="empty-selection">
                      <div className="empty-phone"><Smartphone size={25} /></div>
                      <strong>Your next test device starts here</strong>
                      <span>Select or drag a phone model from the catalog to get started.</span>
                    </div>
                  )}
                  {selected && matchingAvds.length > 1 && <div className="avd-picker"><label htmlFor="avd-picker">Available AVDs</label><select id="avd-picker" value={selectedAvd || matchingAvds[0].name} onChange={(event) => setSelectedAvd(event.target.value)}>{matchingAvds.map((avd) => <option key={avd.name} value={avd.name}>{avd.displayName} · {avd.status}</option>)}</select><ChevronDown size={14} /></div>}
                </div>

                <aside className="config-panel">
                  <div className="panel-title"><span className="step-count">02</span><div><h2>Configuration</h2><p>From your AVD profile</p></div><Settings2 size={17} /></div>
                  <div className="spec-grid">
                    <Spec icon={<Monitor size={15} />} label="RESOLUTION" value={activeAvd?.resolution} />
                    <Spec icon={<Smartphone size={15} />} label="SCREEN SIZE" value={activeAvd?.screenSize} />
                    <Spec icon={<MemoryStick size={15} />} label="MEMORY" value={activeAvd?.ram} />
                    <Spec icon={<Activity size={15} />} label="ANDROID" value={activeAvd?.androidVersion} />
                    <Spec icon={<Database size={15} />} label="OS IMAGE" value={systemFlavorName(activeAvd?.systemImageFlavor)} />
                    <Spec icon={<Code2 size={15} />} label="API LEVEL" value={activeAvd?.apiLevel ? `API ${activeAvd.apiLevel}` : undefined} />
                    <Spec icon={<Cpu size={15} />} label="DEVICE PROFILE" value={activeAvd?.deviceName} />
                  </div>
                  <div className="config-separator" />
                  <div className="setting-row"><div><strong>Orientation</strong><span>Applied after emulator boots</span></div><div className="segmented-control"><button className={orientation === "Portrait" ? "chosen" : ""} onClick={() => setOrientation("Portrait")} aria-pressed={orientation === "Portrait"}>Portrait</button><button className={orientation === "Landscape" ? "chosen" : ""} onClick={() => setOrientation("Landscape")} aria-pressed={orientation === "Landscape"}>Landscape</button></div></div>
                  <div className="setting-row power-row"><div><strong>AC charging</strong><span>{activeAvd?.status === "running" ? "Applied immediately" : "Applied when emulator opens"}</span></div><div className="segmented-control" role="group" aria-label="Emulator AC charging"><button className={charging ? "chosen" : ""} onClick={() => void updateCharging(true)} aria-pressed={charging} disabled={chargingBusy || emulatorStarting}>Charging</button><button className={!charging ? "chosen" : ""} onClick={() => void updateCharging(false)} aria-pressed={!charging} disabled={chargingBusy || emulatorStarting}>Off</button></div></div>
                  <div className="setting-row graphics-row"><div><strong>Graphics</strong><span>Emulator rendering mode</span></div><select value={graphics} onChange={(event) => setGraphics(event.target.value as GraphicsMode)} aria-label="Emulator graphics mode">{graphicsOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                  {!activeAvd && <div className="spec-note"><CircleHelp size={13} /> Only exact manufacturer profiles and positively identified vendor OS images are accepted. Generic Android images cannot substitute.</div>}
                </aside>
              </section>

              <section className="catalog-section">
                <div className="section-title-row"><div><div className="eyebrow small">DEVICE CATALOG</div><h2>Find your next device <span className="result-count">{displayedDevices.length}</span></h2></div>
                  <div className="catalog-tools"><button className={`filter-button${onlyFavorites ? " filter-active" : ""}`} onClick={() => setOnlyFavorites((current) => !current)}><Heart size={14} fill={onlyFavorites ? "currentColor" : "none"} /> Favorites</button><button className="filter-button" onClick={() => setOnlyFavorites(false)}><Smartphone size={14} /> {onlyFavorites ? "Show all" : "All models"}</button></div>
                </div>
                <div className="brand-filters" role="tablist" aria-label="Filter device brand">
                  {brands.map((item) => <button key={item} role="tab" aria-selected={brand === item} className={brand === item ? "brand-filter active" : "brand-filter"} onClick={() => setBrand(item)}>{item}{item === "All devices" && <span>{devices.length}</span>}</button>)}
                </div>
                {displayedDevices.length ? <div className="device-grid">{displayedDevices.map(renderCatalogCard)}</div> : <div className="no-results"><Search size={19} /><strong>No devices found</strong><span>Try another search or clear the current filters.</span><button className="text-button" onClick={() => { setQuery(""); setOnlyFavorites(false); setBrand("All devices"); }}>Clear filters</button></div>}
              </section>

              <section className="bottom-grid">
                <div className="lower-card recent-card">
                  <div className="lower-card-head"><div className="lower-icon"><Clock3 size={16} /></div><div><h3>Recently launched</h3><span>Your latest test devices</span></div><button className="tiny-action" onClick={() => setRecent([])} title="Clear recent devices"><Trash2 size={14} /></button></div>
                  {recentDevices.length ? <div className="recent-list">{recentDevices.slice(0, 4).map((device) => <button key={device.id} className="recent-item" onClick={() => chooseDevice(device)}><div className="mini-phone"><PhoneArt device={device} /></div><span><strong>{device.name}</strong><small>{device.brand}</small></span><ChevronRight size={15} /></button>)}</div> : <div className="lower-empty">Your launched devices will show up here.</div>}
                </div>
                <div className="lower-card connected-card">
                  <div className="lower-card-head"><div className="lower-icon mint"><Usb size={16} /></div><div><h3>Connected devices</h3><span>Detected via Android Debug Bridge</span></div><button className="tiny-action" onClick={() => void refresh()} title="Refresh connected devices"><RefreshCw size={14} /></button></div>
                  {connected.length ? <div className="connected-list">{connected.map((item) => <div key={item.serial} className="connected-item"><span className={`device-state ${item.state === "device" ? "online" : ""}`} /><span><strong>{item.model || item.avdName || item.serial}</strong><small>{item.serial} · {item.state}</small></span><span className="connection-tag">{item.serial.startsWith("emulator-") ? "EMULATOR" : "ADB"}</span></div>)}</div> : <div className="lower-empty"><Usb size={15} /> No connected devices detected.</div>}
                </div>
              </section>
              <footer className="page-footer"><span><span className={`status-dot${sdk.installed ? " good" : ""}`} /> {sdk.installed ? sdk.sdkPath : sdk.message}</span><span>Android Emulator Manager <i>·</i> Built for developers</span></footer>
            </div>
          )}

          {page === "avds" && (
            <div className="subpage">
              <div className="eyebrow"><Smartphone size={13} /> YOUR ANDROID WORKSPACE</div><h1>My virtual <span>devices.</span></h1><p className="subpage-intro">Installed Android Virtual Devices discovered through the SDK Emulator.</p>
              <div className="subpage-toolbar"><div className="summary-pill"><span className="status-dot good" /> {runningCount} running <span className="pill-divider" /> {avds.length} total</div><button className="secondary-button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh AVDs</button></div>
              {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
              {avds.length ? <div className="avd-list">{avds.map((avd) => <AvdCard key={avd.name} avd={avd} onLaunch={() => {
                const match = devices.find((device) => matchAvd(device, [avd]));
                if (match) { chooseDevice(match); setSelectedAvd(avd.name); }
                void launchInstalledAvd(avd, match);
              }} onStop={() => void stopAvd(avd.name)} onRestart={() => void restartAvd(avd)} />)}</div> : <EmptyState icon={<Smartphone size={22} />} title="No virtual devices yet" detail="Choose a phone model in Overview, then create an AVD using an installed SDK profile and system image." action={<button className="primary-button" onClick={() => { setPage("dashboard"); if (!selected) chooseDevice(devices[0]); }}>Browse phone models <ChevronRight size={15} /></button>} />}
            </div>
          )}

          {page === "phones" && (
            <div className="subpage local-phones-page">
              <div className="eyebrow"><Usb size={13} /> YOUR PHYSICAL ANDROID DEVICES</div>
              <h1>Local <span>phones.</span></h1>
              <p className="subpage-intro">Connect a real phone to test its actual manufacturer OS—Samsung One UI, Xiaomi HyperOS, or other vendor software—directly on this computer.</p>
              {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
              <div className="phone-connect-card">
                <div className="phone-connect-header">
                  <div className="lower-icon mint"><Usb size={17} /></div>
                  <div><strong>USB / ADB devices</strong><span>Detected locally by Android Debug Bridge</span></div>
                  <button className="secondary-button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} /> Refresh</button>
                </div>
                {connected.filter((device) => !device.isEmulator).length ? (
                  <div className="physical-device-list">{connected.filter((device) => !device.isEmulator).map((device) => (
                    <button key={device.serial} className={`physical-device${selectedPhoneSerial === device.serial ? " selected" : ""}`} onClick={() => setSelectedPhoneSerial(device.serial)} disabled={device.state !== "device"}>
                      <div className="physical-device-icon"><Smartphone size={21} /></div>
                      <span className="physical-device-details"><strong>{device.manufacturer ? `${device.manufacturer} ` : ""}{device.model || device.serial}</strong><small>{device.serial} · Android {device.androidVersion || "version unknown"}</small></span>
                      <span className={`device-state ${device.state === "device" ? "online" : ""}`} />{device.state}
                    </button>
                  ))}</div>
                ) : (
                  <div className="phone-empty-state">
                    <Smartphone size={25} />
                    <strong>No physical phone connected</strong>
                    <span>This Mac currently sees no Android phone. A real Samsung phone is required to run One UI locally.</span>
                  </div>
                )}
              </div>
              <div className="phone-actions-grid">
                <section className="phone-action-card">
                  <div className="panel-title"><span className="step-count">01</span><div><h2>Install your test app</h2><p>Choose an APK and install it to the selected phone</p></div></div>
                  <div className="phone-action-controls">
                    <button className="secondary-button" onClick={() => void chooseApkFile()} disabled={!selectedPhoneSerial || phoneBusy}><Plus size={14} /> {apkSelection?.name ?? "Choose APK…"}</button>
                    <button className="primary-button" onClick={() => void installSelectedApk()} disabled={!selectedPhoneSerial || !apkSelection || phoneBusy}>{phoneBusy ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />} INSTALL APK</button>
                  </div>
                  <p className="phone-action-hint">Only the APK selected through the native file picker is passed to ADB.</p>
                </section>
                <section className="phone-action-card">
                  <div className="panel-title"><span className="step-count">02</span><div><h2>Launch your app</h2><p>Open an installed app by its Android package name</p></div></div>
                  <div className="phone-action-controls">
                    <input className="package-input" value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="com.example.myapp" aria-label="Android app package name" />
                    <button className="primary-button" onClick={() => void launchPhonePackage()} disabled={!selectedPhoneSerial || !packageName || phoneBusy}><Play size={14} fill="currentColor" /> LAUNCH</button>
                  </div>
                  <p className="phone-action-hint">Find the application ID in your Android project’s Gradle configuration.</p>
                </section>
                <section className="phone-action-card mirror-card">
                  <div className="panel-title"><span className="step-count">03</span><div><h2>Mirror the phone screen</h2><p>Open a local interactive view with scrcpy</p></div></div>
                  <div className="phone-action-controls">
                    <button className="primary-button" onClick={() => void mirrorPhone()} disabled={!selectedPhoneSerial || !sdk.scrcpyPath || phoneBusy}><Monitor size={14} /> MIRROR SCREEN</button>
                    <span className={`mirror-availability${sdk.scrcpyPath ? " ready" : ""}`}>{sdk.scrcpyPath ? "scrcpy detected" : "scrcpy not installed"}</span>
                  </div>
                  {!sdk.scrcpyPath && <p className="phone-action-hint">Install scrcpy on this Mac, then restart the manager. This opens a local mirror—not a remote/browser session.</p>}
                </section>
              </div>
              <section className="phone-setup">
                <div className="panel-title"><span className="step-count">04</span><div><h2>One-time setup on the Galaxy</h2><p>Required before ADB can detect and control your device</p></div></div>
                <ol>
                  <li>On the Galaxy, open <strong>Settings → About phone → Software information</strong>, then tap <strong>Build number</strong> seven times.</li>
                  <li>Open <strong>Developer options</strong> and enable <strong>USB debugging</strong>.</li>
                  <li>Connect the phone to this Mac with a data-capable USB cable; unlock it and accept the <strong>Allow USB debugging</strong> prompt.</li>
                  <li>Press <strong>Refresh</strong> above. Choose the physical phone and install your APK.</li>
                </ol>
                <div className="phone-setup-note"><AlertCircle size={15} /> No phone is currently connected. You’ll need access to a physical Galaxy; this app cannot emulate Samsung One UI.</div>
              </section>
            </div>
          )}

          {page === "remote" && (
            <div className="subpage remote-page">
              <section className="welcome-row">
                <div>
                  <div className="eyebrow"><Cloud size={13} /> REAL SAMSUNG DEVICES</div>
                  <h1>Remote <span>test lab.</span></h1>
                  <p>Use Samsung’s hosted Galaxy phones to test the real One UI experience.</p>
                </div>
              </section>
              <section className="remote-hero">
                <div className="remote-hero-icon"><Smartphone size={27} /></div>
                <div className="remote-hero-copy">
                  <span className="remote-provider-label">SAMSUNG REMOTE TEST LAB</span>
                  <h2>Test on a real Galaxy device</h2>
                  <p>Samsung hosts the devices and runs the interactive testing session on its own website. Sign in there to see which Galaxy models are currently available and start a session.</p>
                  <button className="primary-button remote-launch" onClick={() => void openSamsungRemoteTestLab()}>
                    <ExternalLink size={15} /> OPEN SAMSUNG REMOTE TEST LAB
                  </button>
                </div>
                <div className="remote-status"><span className="status-dot good" /> Hosted by Samsung</div>
              </section>
              <section className="remote-steps">
                <div className="panel-title"><span className="step-count">01</span><div><h2>How to start</h2><p>The device session is managed by Samsung</p></div></div>
                <div className="remote-step-grid">
                  <article className="remote-step"><span>01</span><h3>Sign in</h3><p>Sign in or create an eligible Samsung Developer account on the Remote Test Lab website.</p></article>
                  <article className="remote-step"><span>02</span><h3>Choose a Galaxy</h3><p>Check Samsung’s live catalog for the model, region, and software version you want.</p></article>
                  <article className="remote-step"><span>03</span><h3>Start testing</h3><p>Reserve an available device and interact with it in Samsung’s hosted session.</p></article>
                </div>
              </section>
              <div className="remote-notice"><CircleHelp size={16} /><p><strong>Integration note</strong>This launchpad opens Samsung’s official service. Samsung handles login, device availability, reservations, and the live device stream; those sessions are not embedded or controlled inside this app.</p></div>
              <div className="remote-secondary"><div><strong>Need other brands?</strong><span>Samsung Remote Test Lab provides Samsung devices only. Other brands require another real-device cloud provider or physical phones.</span></div><button className="secondary-button" onClick={() => setPage("dashboard")}><Smartphone size={15} /> Local Android SDK</button></div>
            </div>
          )}

          {page === "logs" && (
            <div className="subpage">
              <div className="eyebrow"><Terminal size={13} /> SYSTEM ACTIVITY</div><h1>Logs & <span>diagnostics.</span></h1><p className="subpage-intro">Android SDK discovery, AVD operations, and emulator launch activity.</p>
              <div className="diagnostic-grid">
                <div className="diagnostic-card"><div className="lower-icon"><Database size={16} /></div><div><span>SDK STATUS</span><strong className={sdk.installed ? "text-green" : "text-muted"}>{sdk.installed ? "Connected" : "Not detected"}</strong><small>{sdk.sdkPath || sdk.message}</small></div></div>
                <div className="diagnostic-card"><div className="lower-icon mint"><Activity size={16} /></div><div><span>EMULATOR STATUS</span><strong>{runningCount} running · {avds.length} available</strong><small>{connected.length} connected device{connected.length === 1 ? "" : "s"} reported by ADB</small></div></div>
              </div>
              <div className="logs-panel"><div className="logs-head"><div><h2>Activity log</h2><span>Most recent events first</span></div><button className="filter-button" onClick={() => setLogs([])}><Trash2 size={14} /> Clear log</button></div>
                {logs.length ? <div className="log-list">{logs.map((entry, index) => <div className="log-entry" key={`${entry.timestamp}-${index}`}><span className={`log-indicator ${entry.level}`} /> <time>{new Date(entry.timestamp).toLocaleTimeString()}</time><span className="log-level">{entry.level}</span><span className="log-message">{entry.message}</span></div>)}</div> : <div className="logs-empty"><Terminal size={19} /><strong>No activity yet</strong><span>SDK and emulator events will appear here.</span></div>}
              </div>
              <div className="troubleshooting"><div className="lower-icon amber"><CircleHelp size={16} /></div><div><strong>Troubleshooting</strong><p>{sdk.message}</p><p>Install Android SDK Platform-Tools, Android Emulator, and Android SDK Command-line Tools in Android Studio's SDK Manager. Set <code>ANDROID_HOME</code> (or <code>ANDROID_SDK_ROOT</code>) to your SDK folder, then refresh.</p><div className="troubleshooting-actions"><button className="filter-button" onClick={() => void refresh()}><RefreshCw size={14} /> Detect SDK again</button>{sdk.sdkPath && <span className="path-chip">{sdk.sdkPath}</span>}</div></div></div>
            </div>
          )}
        </div>
      </main>

      {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setShowCreate(false); }}>
        <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <div className="modal-header"><div className="modal-icon"><Plus size={18} /></div><div><h2 id="create-title">Create virtual device</h2><p>Build an AVD from an installed hardware profile and system image.</p></div><button className="icon-button" onClick={() => setShowCreate(false)} disabled={creating} aria-label="Close dialog"><X size={17} /></button></div>
          {loadingCreateOptions ? <div className="modal-loading"><LoaderCircle className="spin" size={20} /> Loading available SDK profiles...</div> : (
            <>
              {error && <div className="error-banner compact"><AlertCircle size={15} /><span>{error}</span></div>}
              <label className="form-field"><span>AVD name</span><input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="pixel_10_api_35" /></label>
                  <label className="form-field"><span>Exact hardware profile <small>{createProfiles.length} matching profiles</small></span><select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Choose exact manufacturer profile</option>{createProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.manufacturer ? ` · ${profile.manufacturer}` : ""}</option>)}</select></label>
                  <label className="form-field"><span>Vendor OS image <small>{createImages.length} identified images</small></span><select value={imagePath} onChange={(event) => setImagePath(event.target.value)}><option value="">Choose official vendor image</option>{createImages.map((image) => <option key={image.packagePath} value={image.packagePath}>{image.label}</option>)}</select></label>
                  {!createProfiles.length && <div className="modal-notice"><AlertCircle size={15} /> No exact {selected?.brand} hardware profile is installed. A generic or Pixel profile is not a substitute.</div>}
                  {!createImages.length && <div className="modal-notice"><AlertCircle size={15} /> No verified {systemFlavorName(selected ? osFlavorForDevice(selected) : undefined)} image is installed. Generic Android images cannot provide the vendor OS.</div>}
                  <div className="modal-note"><CircleHelp size={14} /><span>The app requires image metadata identifying both the manufacturer and its OS flavor ({systemFlavorName(selected ? osFlavorForDevice(selected) : undefined)}). It will not relabel stock Android as the vendor OS.</span></div>
              <div className="modal-actions"><button className="secondary-button" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button><button className="primary-button" onClick={() => void createAvd()} disabled={creating || !createName || !profileId || !imagePath}>{creating ? <><LoaderCircle size={15} className="spin" /> Creating AVD...</> : <><Plus size={15} /> Create AVD</>}</button></div>
            </>
          )}
        </section>
      </div>}
    </div>
  );
}

function Spec({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  return <div className="spec-item"><div className="spec-label">{icon}<span>{label}</span></div><strong title={value}>{value || "—"}</strong></div>;
}

function AvdCard({ avd, onLaunch, onStop, onRestart }: { avd: AvdInfo; onLaunch: () => void; onStop: () => void; onRestart: () => void }) {
  return <article className="avd-card">
    <div className="avd-card-art"><div className="mini-device-icon"><Smartphone size={23} /></div></div>
    <div className="avd-card-body"><div className="avd-name-row"><h3>{avd.displayName}</h3><span className={`avd-status ${avd.status}`}>{avd.status === "running" ? <Activity size={12} /> : <span />} {avd.status}</span></div><div className="avd-technical"><span>{avd.name}</span>{avd.apiLevel && <span>API {avd.apiLevel}</span>}{avd.resolution && <span>{avd.resolution}</span>}{avd.ram && <span>{avd.ram}</span>}</div><div className="avd-device-line">{avd.deviceName || "Device profile not reported"}{avd.manufacturer ? ` · ${avd.manufacturer}` : ""}</div></div>
    <div className="avd-card-actions">{avd.status !== "stopped" ? <><button className="secondary-button small" onClick={onRestart}><RotateCw size={14} /> Restart</button><button className="stop-button" onClick={onStop}><X size={14} /> Stop</button></> : <button className="primary-button small" onClick={onLaunch}><Play size={14} fill="currentColor" /> Launch</button>}</div>
  </article>;
}

function EmptyState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h2>{title}</h2><p>{detail}</p>{action}</div>;
}

export default App;
