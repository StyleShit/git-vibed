// Shared TypeScript types used across renderer + main process.
// Keep this file free of runtime imports so it can be safely included in
// tsconfig.json (browser) and tsconfig.node.json (node) without introducing
// environment-specific deps.

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted"
  | "typechange"
  | "ignored";

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileStatus;
  staged: boolean;
  insertions?: number;
  deletions?: number;
}

export interface RepoStatus {
  repoPath: string;
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  tracking: string | null;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  // Name of the branch being merged/rebased in, when resolvable. Read from
  // .git/MERGE_MSG / rebase-merge/head-name; may be undefined if git only
  // left a SHA or the file format is unusual.
  incomingBranch?: string;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  body?: string;
  refs: string[];
}

export interface Branch {
  name: string;
  fullName: string;
  isLocal: boolean;
  isRemote: boolean;
  isHead: boolean;
  tracking?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface Stash {
  index: number;
  ref: string;
  // Commit hash the stash points at, so callers (e.g. the graph's right-
  // click menu) can map a selected commit row back to its stash entry
  // without relying on reflog ordering.
  hash: string;
  branch: string | null;
  message: string;
  timestamp: number;
}

export interface Tag {
  name: string;
  commit: string;
  message?: string;
  annotated: boolean;
}

export interface Worktree {
  path: string;
  branch: string | null;
  commit: string;
  isMain: boolean;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason?: string;
}

export interface CommitFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  added: number;
  removed: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  binary: boolean;
  hunks: DiffHunk[];
  raw: string;
}

// Per-line inclusion decision inside a conflict chunk.
//   null  — user hasn't decided yet (pending)
//   true  — include this line in the merged result
//   false — drop this line from the merged result
export type LineDecision = boolean | null;

export interface ConflictRegion {
  kind: "ok" | "conflict";
  ours?: string[];
  base?: string[];
  theirs?: string[];
  resolved?: string[];
  // Parallel arrays to ours / theirs. Conflict regions start with all
  // decisions null; the chunk is considered resolved once every line on
  // both sides has been decided. Resolved content = accepted ours lines
  // followed by accepted theirs lines.
  oursDecisions?: LineDecision[];
  theirsDecisions?: LineDecision[];
  // How many lines this region occupies in each side's own file. For
  // conflict regions these match ours.length and theirs.length. For ok
  // regions they can differ (e.g. a stable chunk that came from ours
  // adding content that theirs didn't have will have theirsSpan = 0).
  oursSpan: number;
  theirsSpan: number;
  // Where the ok region's content came from, used to color lines added
  // by one side relative to base. "both" = content present in all three;
  // "ours"/"theirs" = purely additive from that side.
  source?: "both" | "ours" | "theirs";
  startLine?: number;
  endLine?: number;
}

export interface PullOptions {
  remote?: string;
  branch?: string;
  strategy?: "merge" | "rebase" | "ff-only";
}

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
  setUpstream?: boolean;
}

export interface FetchOptions {
  remote?: string;
  all?: boolean;
  prune?: boolean;
}

export interface CommitOptions {
  message: string;
  amend?: boolean;
  noVerify?: boolean;
}

export interface LogOptions {
  branch?: string;
  limit?: number;
  skip?: number;
  all?: boolean;
}

export interface ConfigEntry {
  key: string;
  value: string;
  scope: "local" | "global" | "system";
  file?: string;
}

export type MergeMethod = "squash" | "merge" | "rebase";

// Snapshot of HEAD undo/redo availability. `undoLabel` is the reflog
// subject of whatever `HEAD@{0}` recorded last (the action we'd roll
// back); `redoLabel` is the stashed reflog subject we captured at the
// time the user undid it.
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

// GitHub types
export interface PullRequest {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  updatedAt: string;
  body?: string;
}

// gh's schema for `pr checks --json` changed: old versions had `status` +
// `conclusion`, newer ones expose `state` (pending|in_progress|success|
// failure|skipped|cancelled|neutral) plus a derived `bucket` (pass|fail|
// pending|skipping|cancel). We prefer the bucket for coloring since it
// collapses the long state list into 5 categories.
export interface Check {
  name: string;
  state: string;
  bucket?: string;
  detailsUrl?: string;
  workflow?: string;
}

export interface PRCreateOptions {
  base: string;
  head: string;
  title: string;
  body?: string;
  draft?: boolean;
  reviewers?: string[];
}

export interface PRReviewOptions {
  number: number;
  action: "approve" | "comment" | "request-changes";
  body?: string;
}

// IPC event payload shapes. Every event includes repoPath so the renderer can
// route updates to the right tab without guessing.
export interface RepoChangedEvent {
  repoPath: string;
  type: "index" | "head" | "refs" | "worktree";
}

export interface FetchCompleteEvent {
  repoPath: string;
  behind: number;
  ahead: number;
  // True when the fetch actually picked up new data (remote refs or tags
  // changed). The renderer uses this to decide whether to refresh branches,
  // log, and tags — skipping the reload on a no-op fetch keeps the UI quiet.
  changed: boolean;
  errors?: string;
}

export interface FetchStartEvent {
  repoPath: string;
}

// Generic result wrapper so renderer can handle errors gracefully.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
