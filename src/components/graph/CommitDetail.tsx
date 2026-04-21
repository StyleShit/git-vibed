import { useEffect, useMemo, useState } from "react";
import { useActive } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { maybe } from "../../lib/ipc";
import {
  CloseIcon,
  CopyIcon,
  PathIcon,
  TreeIcon,
  PullRequestIcon,
  CommitIcon,
  ExternalLinkIcon,
  FolderIcon,
} from "../ui/Icons";
import { Avatar } from "../ui/Avatar";
import type { Commit, CommitFile, FileStatus, PullRequest } from "@shared/types";

// GitKraken-style right-hand panel shown when a commit is selected in the
// graph. Redesign goals: hash badge with copy button, parent links, PR
// association (when head/base matches), files list with status icons and
// add/remove counts, Path/Tree toggle for the file list.
export function CommitDetail({ hash, onClose }: { hash: string; onClose: () => void }) {
  const commits = useActive("commits") ?? [];
  const prs = useActive("prs") ?? [];
  const toast = useUI((s) => s.toast);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [files, setFiles] = useState<CommitFile[]>([]);
  const [view, setView] = useState<"path" | "tree">("path");
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    setCommit(commits.find((x) => x.hash === hash) ?? null);
  }, [hash, commits]);

  useEffect(() => {
    if (!commit) {
      setFiles([]);
      return;
    }
    setLoadingFiles(true);
    void (async () => {
      const res = await maybe(window.gitApi.commitFiles(commit.hash));
      setFiles(res ?? []);
      setLoadingFiles(false);
    })();
  }, [commit]);

  // Link to a PR whose merge commit matches (GitHub writes "Merge pull
  // request #NN" in the subject), or whose head branch tip is this commit.
  const linkedPR = useMemo<PullRequest | null>(() => {
    if (!commit) return null;
    const prNum = /Merge pull request #(\d+)/.exec(commit.subject)?.[1];
    if (prNum) return prs.find((p) => p.number === Number(prNum)) ?? null;
    return null;
  }, [commit, prs]);

  const stats = useMemo(() => {
    const added = files.filter((f) => f.status === "added").length;
    const modified = files.filter((f) => f.status === "modified" || f.status === "renamed").length;
    const deleted = files.filter((f) => f.status === "deleted").length;
    return { added, modified, deleted };
  }, [files]);

  if (!commit) return null;
  const date = new Date(commit.timestamp * 1000);

  function copyHash() {
    void navigator.clipboard.writeText(commit!.hash);
    toast("success", "Copied hash");
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span>commit</span>
          <button
            onClick={copyHash}
            className="mono flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-200 hover:bg-neutral-700"
            title="Copy hash"
          >
            {commit.hash.slice(0, 7)}
            <CopyIcon className="size-3 text-neutral-400" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Close"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-neutral-800 px-3 py-3">
          <div className="text-[15px] font-medium leading-snug text-neutral-100">
            {commit.subject}
          </div>
          {commit.body && (
            <pre className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-300">
              {commit.body}
            </pre>
          )}
        </div>

        <div className="space-y-2 border-b border-neutral-800 px-3 py-3 text-xs">
          <PersonCard
            role="authored"
            name={commit.author}
            email={commit.email}
            date={date}
          />
          {commit.parents.length > 0 && (
            <div className="mt-2 flex items-start gap-2">
              <span className="w-16 shrink-0 text-neutral-500">parent</span>
              <div className="mono flex min-w-0 flex-wrap gap-1 text-neutral-300">
                {commit.parents.map((p) => (
                  <span
                    key={p}
                    className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px]"
                    title={p}
                  >
                    {p.slice(0, 7)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {commit.refs.length > 0 && (
            <div className="mt-2 flex items-start gap-2">
              <span className="w-16 shrink-0 text-neutral-500">refs</span>
              <div className="flex min-w-0 flex-wrap gap-1 text-neutral-300">
                {commit.refs.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px]"
                  >
                    {r.replace(/^tag:/, "tag: ")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {linkedPR && (
          <a
            href={linkedPR.url}
            onClick={(e) => {
              e.preventDefault();
              void window.gitApi.openExternal(linkedPR.url);
            }}
            className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs text-indigo-300 hover:bg-neutral-900"
          >
            <PullRequestIcon className="size-4" />
            <span className="min-w-0 flex-1 truncate">
              #{linkedPR.number} {linkedPR.title}
            </span>
            <ExternalLinkIcon className="size-3 text-neutral-500" />
          </a>
        )}

        <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-neutral-400">
            {stats.modified > 0 && (
              <span>
                <span className="text-neutral-200">{stats.modified}</span> modified
              </span>
            )}
            {stats.added > 0 && (
              <span>
                <span className="text-emerald-400">+ {stats.added}</span> added
              </span>
            )}
            {stats.deleted > 0 && (
              <span>
                <span className="text-red-400">− {stats.deleted}</span> deleted
              </span>
            )}
            {!loadingFiles && files.length === 0 && <span>No files</span>}
          </div>
          <div className="flex rounded border border-neutral-800 p-0.5">
            <ViewToggle
              active={view === "path"}
              onClick={() => setView("path")}
              title="Path"
            >
              <PathIcon className="size-3" /> Path
            </ViewToggle>
            <ViewToggle
              active={view === "tree"}
              onClick={() => setView("tree")}
              title="Tree"
            >
              <TreeIcon className="size-3" /> Tree
            </ViewToggle>
          </div>
        </div>

        <FileList files={files} view={view} hash={commit.hash} />
      </div>
    </aside>
  );
}

function PersonCard({
  role,
  name,
  email,
  date,
}: {
  role: string;
  name: string;
  email: string;
  date: Date;
}) {
  return (
    <div className="flex items-start gap-2">
      <Avatar name={name} email={email} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className="truncate text-sm font-medium text-neutral-100">{name}</span>
          <span className="text-[10px] text-neutral-500">{role}</span>
        </div>
        <div className="truncate text-[11px] text-neutral-500" title={email}>
          {date.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-500 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function FileList({
  files,
  view,
  hash,
}: {
  files: CommitFile[];
  view: "path" | "tree";
  hash: string;
}) {
  if (files.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-neutral-500">
        <CommitIcon className="mx-auto size-6 text-neutral-700" />
        <div className="mt-2">No files to display</div>
      </div>
    );
  }

  if (view === "path") {
    return (
      <ul className="p-1 text-sm">
        {files.map((f) => (
          <FileRow key={f.path} file={f} hash={hash} />
        ))}
      </ul>
    );
  }

  // Tree view: group by directory. Keep it lightweight — no per-folder
  // collapsing (matches typical GitKraken behavior for commit file lists).
  const tree = buildFileTree(files);
  return <TreeView tree={tree} depth={0} hash={hash} />;
}

interface TreeNode {
  name: string;
  file?: CommitFile;
  children: Map<string, TreeNode>;
}

function buildFileTree(files: CommitFile[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let child = node.children.get(p);
      if (!child) {
        child = { name: p, children: new Map() };
        node.children.set(p, child);
      }
      if (i === parts.length - 1) child.file = f;
      node = child;
    }
  }
  return root;
}

function TreeView({ tree, depth, hash }: { tree: TreeNode; depth: number; hash: string }) {
  return (
    <div className="text-sm">
      {[...tree.children.values()].map((n) => (
        <TreeNodeRow key={n.name} node={n} depth={depth} hash={hash} />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  hash,
}: {
  node: TreeNode;
  depth: number;
  hash: string;
}) {
  const isFile = !!node.file;
  if (isFile && node.children.size === 0) {
    return <FileRow file={node.file!} label={node.name} depth={depth} hash={hash} />;
  }
  return (
    <>
      <div
        className="flex items-center gap-1.5 py-1 text-sm text-neutral-400"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </div>
      {[...node.children.values()].map((c) => (
        <TreeNodeRow key={c.name} node={c} depth={depth + 1} hash={hash} />
      ))}
    </>
  );
}

function FileRow({
  file,
  label,
  depth = 0,
  hash,
}: {
  file: CommitFile;
  label?: string;
  depth?: number;
  hash: string;
}) {
  const selectCommitFile = useUI((s) => s.selectCommitFile);
  const activeFile = useUI((s) => s.selectedCommitFile);
  const isActive = activeFile?.hash === hash && activeFile?.path === file.path;
  return (
    <button
      onClick={() => selectCommitFile({ hash, path: file.path })}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
        isActive ? "bg-indigo-500/15" : "hover:bg-neutral-800"
      }`}
      title={file.path}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <StatusBadge status={file.status} />
      <span className="min-w-0 flex-1 truncate text-neutral-200">{label ?? file.path}</span>
      <span className="mono shrink-0 text-[10px]">
        {file.added > 0 && <span className="text-emerald-400">+{file.added}</span>}
        {file.added > 0 && file.removed > 0 && " "}
        {file.removed > 0 && <span className="text-red-400">−{file.removed}</span>}
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  const map: Record<FileStatus, { letter: string; color: string }> = {
    added: { letter: "A", color: "bg-emerald-500/20 text-emerald-300" },
    modified: { letter: "M", color: "bg-amber-500/20 text-amber-300" },
    deleted: { letter: "D", color: "bg-red-500/20 text-red-300" },
    renamed: { letter: "R", color: "bg-blue-500/20 text-blue-300" },
    untracked: { letter: "?", color: "bg-neutral-700 text-neutral-300" },
    conflicted: { letter: "!", color: "bg-red-500/30 text-red-300" },
    typechange: { letter: "T", color: "bg-violet-500/20 text-violet-300" },
    ignored: { letter: "I", color: "bg-neutral-700 text-neutral-400" },
  };
  const s = map[status];
  return (
    <span
      className={`mono flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${s.color}`}
      title={status}
    >
      {s.letter}
    </span>
  );
}
