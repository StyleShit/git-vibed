import { useEffect, useState } from "react";

// Author avatar: tries Gravatar based on the email, falls back to deterministic
// colored initials if the image doesn't load (no network / private email).
// Safe for offline use — the <img> just fails silently and we keep the initials.
interface Props {
  name: string;
  email?: string;
  size?: number;
  className?: string;
}

export function Avatar({ name, email, size = 20, className = "" }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
    // Prefer GitHub's user avatar URL when the email is a github noreply
    // address. `github.com/<username>.png` is the canonical endpoint that
    // redirects to the user's current avatar regardless of numeric ID, so
    // we use it instead of avatars.githubusercontent.com/u/<id> which can
    // 404 for users who rotated their ID.
    const gh = parseGithubNoreply(email);
    if (gh) {
      setSrc(`https://github.com/${gh.username}.png?size=${size * 2}`);
      return;
    }
    if (email) {
      void sha256(email.trim().toLowerCase()).then((h) => {
        setSrc(`https://www.gravatar.com/avatar/${h}?s=${size * 2}&d=404`);
      });
    } else {
      setSrc(null);
    }
  }, [email, size]);

  const initials = nameInitials(name);
  const color = colorFor(name || email || "?");

  if (src && !errored) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        className={`inline-block shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium uppercase text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}

// GitHub's noreply emails come in two formats:
//   <username>@users.noreply.github.com           (legacy)
//   <id>+<username>@users.noreply.github.com      (current)
// Parsing this lets us use the canonical GitHub avatar instead of gravatar.
function parseGithubNoreply(email?: string): { id?: string; username: string } | null {
  if (!email) return null;
  const m = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email.trim());
  if (!m) return null;
  return { id: m[1], username: m[2] };
}

function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Palette picked for good contrast against a dark UI. Deterministic hash
// mapping means the same person gets the same color everywhere.
const PALETTE = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
  "#a855f7", // purple
  "#22c55e", // green
  "#0ea5e9", // sky
  "#d946ef", // fuchsia
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Remote avatar — for GitHub repos we fetch the owner's actual avatar via
// GitHub's PNG endpoint (no auth needed, honors org/user). For other hosts
// we fall back to a letter badge colored by host brand.
export function RemoteAvatar({ url, size = 14 }: { url: string; size?: number }) {
  const [errored, setErrored] = useState(false);
  const parsed = parseRemoteUrl(url);

  if (parsed?.host === "github" && !errored) {
    return (
      <img
        src={`https://github.com/${parsed.owner}.png?size=${size * 2}`}
        alt={parsed.owner}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        className="inline-block shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        title={`${parsed.owner}/${parsed.repo}`}
      />
    );
  }

  const host = parsed?.host ?? null;
  const color =
    host === "github"
      ? "#ffffff"
      : host === "gitlab"
        ? "#fc6d26"
        : host === "bitbucket"
          ? "#2684ff"
          : "#a3a3a3";
  const letter = host ? host[0].toUpperCase() : "G";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
      style={{ width: size, height: size, backgroundColor: color, color: "#0a0a0a" }}
      title={host ?? "remote"}
    >
      {letter}
    </span>
  );
}

// Pull host + owner + repo out of both HTTPS and SSH remote URLs:
//   https://github.com/owner/repo.git
//   git@github.com:owner/repo.git
// Owner gives us the org/user avatar; we keep repo around for tooltips.
export function parseRemoteUrl(
  url: string,
): { host: "github" | "gitlab" | "bitbucket"; owner: string; repo: string } | null {
  const clean = url.replace(/\.git$/, "");
  const https = /https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/.exec(clean);
  const ssh = /git@([^:]+):([^/]+)\/([^/]+)/.exec(clean);
  const m = https ?? ssh;
  if (!m) return null;
  const hostname = m[1];
  const host: "github" | "gitlab" | "bitbucket" | null = /github\.com$/i.test(hostname)
    ? "github"
    : /gitlab\.com$/i.test(hostname)
      ? "gitlab"
      : /bitbucket\.org$/i.test(hostname)
        ? "bitbucket"
        : null;
  if (!host) return null;
  return { host, owner: m[2], repo: m[3] };
}
