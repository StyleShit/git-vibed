import { app, BrowserWindow, dialog, shell, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerGitHandlers } from "./ipc/git-handlers.js";
import { registerGhHandlers } from "./ipc/gh-handlers.js";
import { RepoManager } from "./git/repo-manager.js";
import { GIT } from "../src/shared/ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let mainWindow: BrowserWindow | null = null;
let repoManager: RepoManager | null = null;

// Recent repos — persisted as JSON in userData. We intentionally keep this
// tiny and dependency-free rather than pulling electron-store (ESM quirks).
import fs from "node:fs";

function recentReposPath() {
  return path.join(app.getPath("userData"), "recent-repos.json");
}

function loadRecentRepos(): string[] {
  try {
    const raw = fs.readFileSync(recentReposPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentRepos(paths: string[]) {
  try {
    fs.mkdirSync(path.dirname(recentReposPath()), { recursive: true });
    fs.writeFileSync(recentReposPath(), JSON.stringify(paths.slice(0, 10)));
  } catch {
    // Non-fatal — just skip persistence.
  }
}

function addRecentRepo(repoPath: string) {
  const existing = loadRecentRepos().filter((p) => p !== repoPath);
  existing.unshift(repoPath);
  saveRecentRepos(existing);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  // Open external links in the default browser rather than a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  repoManager = new RepoManager((channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  });

  registerGitHandlers(ipcMain, repoManager);
  registerGhHandlers(ipcMain, () => repoManager?.repoPath ?? null);

  // App-level handlers that don't fit neatly into git/gh modules.
  ipcMain.handle(GIT.SHOW_OPEN_DIALOG, async () => {
    if (!mainWindow) return { ok: false as const, error: "No main window" };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Open Git Repository",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, error: "User cancelled" };
    }
    return { ok: true as const, data: result.filePaths[0] };
  });

  ipcMain.handle(GIT.OPEN_EXTERNAL, async (_e, url: string) => {
    try {
      await shell.openExternal(url);
      return { ok: true as const, data: true };
    } catch (e) {
      return { ok: false as const, error: String(e) };
    }
  });

  ipcMain.handle(GIT.RECENT_REPOS, () => ({
    ok: true as const,
    data: loadRecentRepos(),
  }));

  // Track new repo opens so the sidebar's recent list stays warm.
  repoManager.onRepoOpen((p) => addRecentRepo(p));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  repoManager?.dispose();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  repoManager?.dispose();
});

// Harden against accidental file drops reloading the window with a local file.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
});
