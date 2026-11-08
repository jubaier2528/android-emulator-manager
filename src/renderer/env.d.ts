import type { EmulatorApi } from "../electron/shared";

declare global {
  interface Window {
    emulatorManager: EmulatorApi;
  }
}

export {};
