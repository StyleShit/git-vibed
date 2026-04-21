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
  // We walk through a list of candidate URLs (GitHub noreply → SHA256 Gravatar
  // → MD5 Gravatar) — on each onError we advance to the next, finally falling
  // through to initials. Using a ladder instead of a single src fixes the
  // previous bug where SHA256-only Gravatar lookups 404'd for the majority of
  // users whose profiles were registered under MD5 hashes.
  const [candidates, setCandidates] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
    void (async () => {
      const list: string[] = [];
      const bot = detectKnownBot(email, name);
      if (bot) {
        // Known bots have a stable, canonical avatar that the noreply
        // heuristic doesn't always pick up (the commit email often comes
        // through without the numeric ID prefix).
        list.push(`https://github.com/${bot}.png?size=${size * 2}`);
      }
      const gh = parseGithubNoreply(email);
      if (gh) {
        // Prefer the numeric-ID endpoint when available: usernames can
        // change (and then github.com/<oldname>.png 404s), but the
        // numeric ID embedded in the noreply email is stable.
        if (gh.id) {
          list.push(`https://avatars.githubusercontent.com/u/${gh.id}?s=${size * 2}&v=4`);
        }
        list.push(`https://github.com/${gh.username}.png?size=${size * 2}`);
      }
      if (email) {
        const normalized = email.trim().toLowerCase();
        const [sha, md5] = await Promise.all([sha256(normalized), md5Hex(normalized)]);
        list.push(`https://www.gravatar.com/avatar/${sha}?s=${size * 2}&d=404`);
        list.push(`https://www.gravatar.com/avatar/${md5}?s=${size * 2}&d=404`);
      }
      setCandidates(list);
    })();
  }, [email, name, size]);

  const src = candidates[idx];
  const initials = nameInitials(name);
  const color = colorFor(name || email || "?");

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        onError={() => setIdx((i) => i + 1)}
        referrerPolicy="no-referrer"
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

// Match common bot authors so we land on their canonical avatar right
// away instead of waiting for Gravatar 404s to drop through the ladder.
function detectKnownBot(email: string | undefined, name: string): string | null {
  const src = `${(email ?? "").toLowerCase()} ${name.toLowerCase()}`;
  if (src.includes("dependabot")) return "dependabot";
  // GitHub Actions bot — use the github.png avatar (GitHub's own mark)
  // which is what the UI shows for actions/workflow authored commits.
  // The numeric 41898282 is the GitHub Actions bot's noreply user id.
  if (
    src.includes("github-actions") ||
    src.includes("github actions") ||
    src.includes("41898282+")
  ) {
    return "github";
  }
  return null;
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

// Instead of bucketing names into a fixed 12-color palette (where the
// pigeonhole principle guarantees collisions as soon as you see ~13
// contributors), we derive a hue directly from the name hash and render
// via HSL. That gives 360 distinct hues with an even distribution and
// keeps saturation/lightness fixed so every avatar stays readable on
// the dark UI.
function colorFor(seed: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis for better bit mixing
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // Prime multiplier + xor-shift stages reduce clustering so names
    // that share a prefix (e.g. "Alex Smith" vs "Alex Jones") land on
    // visibly different hues instead of adjacent palette slots.
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 62% 52%)`;
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// MD5 — required for Gravatar's legacy hash format, which is what most
// existing profiles were registered under. WebCrypto doesn't implement MD5
// so we fall back to a tiny pure-JS implementation. Matches RFC 1321.
function md5Hex(input: string): Promise<string> {
  return Promise.resolve(md5(input));
}

function md5(str: string): string {
  // Encode input to UTF-8 bytes first so non-ASCII emails hash consistently
  // with what Gravatar's backend expects.
  const bytes = new TextEncoder().encode(str);
  const nBits = bytes.length * 8;
  // Pre-allocate padded message: original bytes + 0x80 + zero pad + 64-bit length
  const padLen = (((bytes.length + 8) >>> 6) + 1) * 64;
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(padLen - 8, nBits >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(nBits / 0x100000000), true);

  // MD5 constants
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  for (let i = 0; i < padLen; i += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(i + j * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number;
      let g: number;
      if (j < 16) {
        F = (B & C) | (~B & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | (~D & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * j) % 16;
      }
      F = (F + A + K[j] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[j])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0].map(toHexLE).join("");
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function toHexLE(n: number): string {
  // Little-endian byte order for MD5 output.
  return (
    ((n & 0xff) << 24 | ((n >>> 8) & 0xff) << 16 | ((n >>> 16) & 0xff) << 8 | ((n >>> 24) & 0xff))
      .toString(16)
      .padStart(8, "0")
  );
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
        referrerPolicy="no-referrer"
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
