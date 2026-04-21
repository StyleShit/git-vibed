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

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M14 8h-2M4 8H2M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4M12.2 12.2l-1.4-1.4M5.2 5.2 3.8 3.8" />
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

// VSCode-style "collapse all" / "expand all" — a tree outline with an
// inward/outward chevron indicating the direction. Clearer than two plain
// chevrons because the tree metaphor connects the icon to folders.
export function ExpandAllIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3h5" />
      <path d="M4 3v4h3" />
      <path d="M4 7v4h3" />
      <path d="M4 11v2h3" />
      <path d="m10 8 2 2 2-2" />
    </Svg>
  );
}

export function CollapseAllIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3h5" />
      <path d="M4 3v4h3" />
      <path d="M4 7v4h3" />
      <path d="M4 11v2h3" />
      <path d="m10 10 2-2 2 2" />
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
