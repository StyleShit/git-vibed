import type { GitApi, GhApi } from "../src-electron/preload";

declare global {
  interface Window {
    gitApi: GitApi;
    ghApi: GhApi;
  }
}

export {};
