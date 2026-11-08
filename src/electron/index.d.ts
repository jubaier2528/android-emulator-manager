import type { EmulatorApi } from "./shared";

declare global {
  interface Window {
    emulatorManager: EmulatorApi;
  }
}

export {};
