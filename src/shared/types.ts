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

export interface ConflictRegion {
  kind: "ok" | "conflict";
  ours?: string[];
  base?: string[];
  theirs?: string[];
  resolved?: string[];
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
  signOff?: boolean;
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
  errors?: string;
}

// Generic result wrapper so renderer can handle errors gracefully.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
