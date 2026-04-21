// Shared SVG icon set — inline so we can color them with currentColor and
// avoid shipping a heavy icon dependency. Tailwind's `size-*` utilities size
// them; callers can override `className` to tweak placement.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...p }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export function BranchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M4 4.5v7" />
      <path d="M4 8h2a4 4 0 0 0 4-4v-.5" />
    </Svg>
  );
}

export function FolderIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3L7 4h6.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function RemoteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M2 8h12M8 2v12" />
    </Svg>
  );
}

export function TagIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 7V3a1 1 0 0 1 1-1h4l7 7-5 5z" />
      <circle cx="5" cy="5" r="0.75" fill="currentColor" />
    </Svg>
  );
}

export function StashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="4" width="12" height="8" rx="1" />
      <path d="M2 7h12" />
      <path d="M6 10h4" />
    </Svg>
  );
}

export function WorktreeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="5" height="5" rx="0.75" />
      <rect x="9" y="3" width="5" height="5" rx="0.75" />
      <rect x="5.5" y="9" width="5" height="4" rx="0.75" />
    </Svg>
  );
}

export function PullRequestIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="13" r="1.5" />
      <path d="M4 4.5v7" />
      <path d="M12 11.5V6a2 2 0 0 0-2-2H8.5M10.5 2.5 8.5 4l2 1.5" />
    </Svg>
  );
}

export function CommitIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="3" />
      <path d="M2 8h3M11 8h3" />
    </Svg>
  );
}

export function FetchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3v7M8 10 4.5 6.5M8 10l3.5-3.5" />
      <path d="M3 13h10" />
    </Svg>
  );
}

export function PullIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2v9M8 11 4.5 7.5M8 11l3.5-3.5M3 14h10" />
    </Svg>
  );
}

export function PushIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 14V5M8 5 4.5 8.5M8 5l3.5 3.5M3 2h10" />
    </Svg>
  );
}

export function UndoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h7a3 3 0 0 1 0 6H6" />
      <path d="M6 4 3 7l3 3" />
    </Svg>
  );
}

export function RedoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 7H5a3 3 0 0 0 0 6h5" />
      <path d="M10 4l3 3-3 3" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </Svg>
  );
}

export function TerminalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="m5 7 2 1.5L5 10M8.5 10H11" />
    </Svg>
  );
}

// Classic cog with visible teeth around the rim — more recognizable as a
// "settings" affordance than the old circle-with-spokes variant.
export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5 9 3h1.5l.75 1.3 1.5.4L13 6l1.3 1 -.3 1.5 1 1 -1 1 .3 1.5L13 13l-.25 1.3-1.5.4L10.5 16H9l-1 -1.5 -1 1.5H5.5l-.75-1.3-1.5-.4L3 13l-1.3-1 .3-1.5-1-1 1-1 -.3-1.5L3 6l.25-1.3 1.5-.4L5.5 3H7z" opacity="0" />
      <path d="M6.5 1.5h3l.3 1.6a5.6 5.6 0 0 1 1.3.75l1.55-.55 1.5 2.6-1.25 1.05a5.6 5.6 0 0 1 0 1.5l1.25 1.05-1.5 2.6-1.55-.55a5.6 5.6 0 0 1-1.3.75l-.3 1.6h-3l-.3-1.6a5.6 5.6 0 0 1-1.3-.75l-1.55.55-1.5-2.6 1.25-1.05a5.6 5.6 0 0 1 0-1.5L2.15 5.1l1.5-2.6 1.55.55a5.6 5.6 0 0 1 1.3-.75z" />
      <circle cx="8" cy="8" r="2" />
    </Svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 6 4 4 4-4" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 4 4 4-4 4" />
    </Svg>
  );
}

export function ChevronUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 10 4-4 4 4" />
    </Svg>
  );
}

export function MagicWandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 13 8-8 2 2-8 8z" />
      <path d="m9 5 2 2" />
      <path d="M6 2v2M5 3h2" />
      <path d="M13 9v2M12 10h2" />
    </Svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7 4-3 4 3 4" />
      <path d="M4 8h9" />
    </Svg>
  );
}

export function ArrowRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 4 3 4-3 4" />
      <path d="M3 8h9" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="0.75" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M3 11V4a1 1 0 0 1 1-1h7" />
    </Svg>
  );
}

export function ExternalLinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 3h3v3M13 3 7 9M12 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
    </Svg>
  );
}

export function TreeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3h5M3 6h3M3 9h4M3 12h5M1 3v9" />
    </Svg>
  );
}

export function PathIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 4h12M2 8h12M2 12h12" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 8 3.5 3.5L13 5" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Svg>
  );
}

export function FileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 2h5.5l2.5 2.5V14a0 0 0 0 1 0 0H4a0 0 0 0 1 0 0V2z" />
      <path d="M9.5 2v2.5H12" />
    </Svg>
  );
}

export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="3" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="13" cy="8" r="1" fill="currentColor" />
    </Svg>
  );
}

// Two chevrons meeting/parting in the middle — a compact visual for
// "expand everything" (arrows pushing outward) and "collapse
// everything" (arrows pulling inward) that mirrors the macOS
// UIKit / JetBrains expand-collapse pair.
export function ExpandAllIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 6 4-4 4 4" />
      <path d="m4 10 4 4 4-4" />
    </Svg>
  );
}

export function CollapseAllIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 3 4 4 4-4" />
      <path d="m4 13 4-4 4 4" />
    </Svg>
  );
}

export function FolderOpenIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 4.5A1 1 0 0 1 2.5 3.5h3L7 5h6.5a1 1 0 0 1 1 1v1h-12v5a1 1 0 0 1-1 1 1 1 0 0 1-1-1z" />
      <path d="M2.5 13h11l1-6h-12z" />
    </Svg>
  );
}

// Small laptop/computer glyph — used on local-branch ref badges so they're
// visually distinguishable from remote-branch badges (which show the host
// avatar) at a glance.
export function ComputerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M1 13h14" />
      <path d="M6 13v-2M10 13v-2" />
    </Svg>
  );
}
