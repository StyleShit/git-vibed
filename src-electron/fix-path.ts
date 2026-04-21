import { execFileSync } from "node:child_process";

// When Electron is launched from Finder/Dock/Spotlight on macOS (and .desktop
// launchers on Linux) it inherits a minimal PATH — nothing from /opt/homebrew,
// fnm/nvm, ~/Library/pnpm, or other user-level installers. `git` itself lives
// in /usr/bin so commits start fine, but repo hooks (husky → pnpm, lint-staged
// → node, etc.) die with `command not found`. Resolve the user's login-shell
// PATH once at startup and prepend it so spawned git processes — and the
// hooks they invoke — see what the user's terminal would see.
export function fixPath(): void {
  if (process.platform === "win32") return;
  const shell = process.env.SHELL || "/bin/zsh";
  // Wrap PATH in markers so we can pick it out reliably even when rc scripts
  // print banners/notices (fnm "Using Node vX.Y.Z", oh-my-zsh warnings, …).
  const marker = "__GV_PATH_FIX__";
  try {
    const out = execFileSync(
      shell,
      ["-ilc", `echo "${marker}:$PATH:${marker}"`],
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const m = out.match(new RegExp(`${marker}:(.+?):${marker}`));
    const resolved = m?.[1]?.trim();
    if (!resolved) return;
    process.env.PATH = `${resolved}:${process.env.PATH ?? ""}`;
  } catch {
    // Non-fatal — worst case the hook still fails with the same error as before.
  }
}
