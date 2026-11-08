# Android Emulator Manager

A local Electron desktop app for browsing Android phone models, inspecting installed Android Virtual Devices (AVDs), configuring emulator startup, and launching the real Android SDK Emulator. It is designed to work alongside VS Code and does not require Android Studio's graphical interface to stay open.

> **Hardware accuracy:** the phone catalog is a model picker, not a hardware-spec database. Resolution, configured display size, memory, Android system-image API, and device-profile name are read from the selected AVD's SDK configuration. A catalog phone does not imply an installed AVD or claim specifications the SDK has not reported.

## Requirements

- Node.js 20.19+ (Node.js 22+ recommended) and npm
- Android SDK with **Android Emulator** and **Android SDK Platform-Tools** installed
- To create AVDs: **Android SDK Command-line Tools** (`avdmanager`) and at least one installed SDK system image

The app detects common SDK locations and the `ANDROID_HOME` / `ANDROID_SDK_ROOT` environment variables. `ANDROID_AVD_HOME` is honored for custom AVD storage.

## Install and run

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer and opens the Electron desktop window. The app talks directly to `emulator`, `adb`, and `avdmanager` using validated argument arrays; it does not accept or execute shell commands from the UI.

Build the renderer and Electron main/preload code:

```bash
npm run typecheck
npm run build
```

Create a distributable for the current host platform:

```bash
npm run package
```

The packaging configuration targets macOS, Windows (NSIS), and Linux (AppImage). Build each target on its corresponding platform.

## VS Code setup

1. Install Android Studio once, or install the Android SDK command-line packages directly.
2. In Android Studio, open **SDK Manager → SDK Tools** and install **Android SDK Platform-Tools**, **Android Emulator**, and **Android SDK Command-line Tools (latest)**.
3. Install a system image under **SDK Platforms → Show Package Details** or with `sdkmanager`.
4. Ensure the SDK folder is discoverable. For example, on macOS:

   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export ANDROID_SDK_ROOT="$ANDROID_HOME"
   ```

   Add these to the shell profile used by VS Code if needed. On Windows, set the same variables to the SDK directory (commonly `%LOCALAPPDATA%\Android\Sdk`); on Linux, the default is `~/Android/Sdk`.
5. Open this project in VS Code, open its integrated terminal, run `npm install`, then `npm run dev`.
6. Select a model marked **Native OS ready to create** or with an existing native AVD, then choose **CREATE & OPEN** or **OPEN EMULATOR**. Creation is available only when SDK metadata identifies both the exact manufacturer hardware profile and the required OS flavor (Google Android, Samsung One UI, Xiaomi HyperOS, or OnePlus OxygenOS). Generic Android and Google Pixel images are never substituted for another manufacturer's OS.

Electron inherits environment variables from the process that starts it. If you change SDK variables after VS Code is open, restart VS Code or launch the app from a terminal with the updated environment.

## What the app does

- Searches and filters Google Pixel, Samsung Galaxy, OnePlus, and Xiaomi catalog models. Cards are launchable only when an exact manufacturer profile and positively identified vendor OS image are installed.
- Persists favorites and recently launched catalog selections in local browser storage.
- Discovers AVDs with `emulator -list-avds`, reads their `.ini` and `config.ini` files, and checks runtime state through `adb devices`.
- Shows resolution, RAM, image API, configured display size (derived from the AVD's configured pixel dimensions and density), and hardware profile only when present in SDK configuration.
- Starts an installed AVD with `emulator -avd <name> -gpu <mode>`, applies portrait/landscape rotation with ADB after startup, and stops it with `adb -s <serial> emu kill`.
- Creates AVDs only from exact manufacturer profiles returned by `avdmanager list device` and SDK-installed images with matching vendor and OS-flavor metadata. Samsung images must identify One UI, Xiaomi images HyperOS/MIUI, and OnePlus images OxygenOS. It refuses to pass off stock Android or a Pixel profile as another manufacturer's device/OS.
- Keeps an activity log and displays SDK, AVD, running emulator, and ADB-connected device status.

## Troubleshooting

### SDK not detected

Install the Emulator and Platform-Tools packages, then set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to the SDK root (the directory containing `emulator/` and `platform-tools/`). Refresh in the app. Common locations are `~/Library/Android/sdk` on macOS, `%LOCALAPPDATA%\Android\Sdk` on Windows, and `~/Android/Sdk` on Linux.

### Existing AVDs do not appear

Confirm `emulator -list-avds` in the VS Code integrated terminal. The app uses `ANDROID_AVD_HOME` when set, otherwise `~/.android/avd`. Refresh after changing the AVD directory or creating an AVD externally.

### Cannot create or open a catalog device

AVD creation requires Android SDK Command-line Tools, an exact manufacturer hardware profile, and a system image package whose `source.properties` metadata identifies both the vendor and OS flavor. Standard Android SDK images are Google/AOSP images; Android Studio does not ordinarily provide Samsung One UI, Xiaomi HyperOS/MIUI, or OnePlus OxygenOS images. If a vendor does not provide supported emulator images/profiles for your SDK, that catalog model cannot run its genuine OS in this app. A stock Android image or a visual skin is not the vendor OS.

### Emulator launch fails or hangs

Check the in-app Logs & diagnostics page. Try **Automatic** or **Software (SwiftShader)** graphics, confirm the selected AVD starts with `emulator -avd <AVD_NAME>` in the integrated terminal, and check that virtualization is supported and enough memory/disk space is available. The app reports startup after the emulator registers with ADB; first boot can take longer than usual.

### Emulator is running but not listed as connected

Run `adb devices` in the integrated terminal and confirm the emulator state is `device`, not `offline` or `unauthorized`. Refresh the app once the boot completes. For device-specific startup or rendering diagnostics, run the SDK Emulator directly in the terminal.

## Security and implementation

The renderer has no Node.js integration. A context-isolated, sandboxed preload exposes a small, typed IPC API. The main process validates AVD names, system-image package identifiers, device-profile IDs, orientation, and graphics modes; it launches only SDK executables with argument arrays and shell execution disabled. Windows `.bat` SDK tools are invoked through the platform command interpreter with allowlisted SDK arguments. UI input never becomes an arbitrary shell command.
