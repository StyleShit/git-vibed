import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveTab } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { gitStatusOptions } from "../../queries/gitApi";
import { commitMutation } from "../../queries/mutations";

export function CommitPanel() {
  const activePath = useActiveTab()?.path;
  const status = useQuery(gitStatusOptions(activePath)).data ?? null;
  const commitMut = useMutation(commitMutation(activePath ?? ""));
  const toast = useUI((s) => s.toast);
  const skipHooksDefault = useSettings((s) => s.skipHooksByDefault);
  const setSkipHooksDefault = useSettings((s) => s.setSkipHooksByDefault);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [skipHooks, setSkipHooks] = useState(skipHooksDefault);
  const [busy, setBusy] = useState(false);
  const [prevMessageCache, setPrevMessageCache] = useState<string>("");
  // Restore point for toggling amend off without clobbering in-progress text.
  const [savedMessage, setSavedMessage] = useState<{ subject: string; description: string } | null>(
    null,
  );
  // Track whether we already pre-filled from MERGE_MSG so we don't clobber
  // user edits on every status refresh while the merge is still in progress.
  // Also remember the exact prefilled text so we can cleanly wipe it on
  // merge abort without touching anything the user typed themselves.
  const [mergeMessagePrefilled, setMergeMessagePrefilled] = useState(false);
  const [prefilledText, setPrefilledText] = useState<{
    subject: string;
    description: string;
  } | null>(null);

  const mergeInProgress = !!status?.mergeInProgress;
  const conflictsRemaining = (status?.conflicted.length ?? 0) > 0;
  const staged = status?.staged ?? [];
  // During a merge, git finalizes the commit even with no staged changes
  // beyond what it already recorded in MERGE_HEAD, so relax the usual
  // "needs staged files" guard.
  const canCommit =
    !busy &&
    subject.trim().length > 0 &&
    !conflictsRemaining &&
    (amend || mergeInProgress || staged.length > 0);
  const fullMessage = description.trim()
    ? `${subject.trim()}\n\n${description.trim()}`
    : subject.trim();

  // When amend toggles on, preload the title + description from the last
  // commit. When toggling off, restore whatever was there before.
  useEffect(() => {
    void (async () => {
      if (amend) {
        setSavedMessage({ subject, description });
        let prevSubject = "";
        let prevDescription = "";
        if (prevMessageCache) {
          const [first, ...rest] = prevMessageCache.split(/\n\n/);
          prevSubject = first ?? "";
          prevDescription = rest.join("\n\n");
        } else {
          const res = await window.gitApi.log(activePath ?? "", {
            limit: 1,
            all: false,
          });
          if (res.ok && res.data[0]) {
            prevSubject = res.data[0].subject;
            prevDescription = res.data[0].body ?? "";
            setPrevMessageCache(
              prevSubject + (prevDescription ? "\n\n" + prevDescription : ""),
            );
          }
        }
        setSubject(prevSubject);
        setDescription(prevDescription);
      } else if (savedMessage) {
        setSubject(savedMessage.subject);
        setDescription(savedMessage.description);
        setSavedMessage(null);
      } else {
        setSubject("");
        setDescription("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend]);

  // Keyboard shortcut (Cmd/Ctrl+Enter) triggered from the global hook.
  useEffect(() => {
    function onCommit() {
      if (canCommit) void commit();
    }
    window.addEventListener("gitvibed:commit", onCommit);
    return () => window.removeEventListener("gitvibed:commit", onCommit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCommit, subject, description, amend, skipHooks]);

  // Pre-fill the subject/description from .git/MERGE_MSG when a merge
  // starts. Only runs once per merge (guarded by mergeMessagePrefilled)
  // so we don't stomp on edits the user makes while resolving conflicts.
  // When the merge ends (committed OR aborted), wipe the prefilled text
  // if it's still untouched so the box isn't left holding a stale
  // "Merge branch X into Y" line from a merge the user just aborted.
  useEffect(() => {
    if (!mergeInProgress) {
      if (mergeMessagePrefilled) {
        if (
          prefilledText &&
          subject === prefilledText.subject &&
          description === prefilledText.description
        ) {
          setSubject("");
          setDescription("");
        }
        setMergeMessagePrefilled(false);
        setPrefilledText(null);
      }
      return;
    }
    if (mergeMessagePrefilled || amend) return;
    void (async () => {
      const res = await window.gitApi.mergeMessage();
      if (!res.ok || !res.data) return;
      const [first, ...rest] = res.data.split(/\n\n/);
      // Only prefill if the user hasn't already started typing something,
      // so their own subject wins over the git-generated one.
      if (!subject.trim() && !description.trim()) {
        const nextSubject = first ?? "";
        const nextDescription = rest.join("\n\n");
        setSubject(nextSubject);
        setDescription(nextDescription);
        setPrefilledText({ subject: nextSubject, description: nextDescription });
      }
      setMergeMessagePrefilled(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeInProgress, amend]);

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    try {
      await commitMut.mutateAsync({
        message: fullMessage,
        amend,
        noVerify: skipHooks,
      });
      toast(
        "success",
        mergeInProgress ? "Merge completed" : amend ? "Commit amended" : "Committed",
      );
      setSubject("");
      setDescription("");
      setAmend(false);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-925 p-3">
      <div className="relative">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Commit message"
          className="mono w-full rounded bg-neutral-800 p-2 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-indigo-500"
        />
        {/* Visual guide past 72 chars — subject lines past that wrap badly
            in many tools (terminal, GitHub history). Shade the excess area
            so the user gets a gentle nudge to keep subjects short. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 p-2 opacity-40"
          style={{
            background:
              "linear-gradient(to right, transparent calc(72ch + 8px), rgba(239,68,68,0.08) calc(72ch + 8px))",
          }}
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        rows={4}
        className="mono mt-2 w-full resize-none rounded bg-neutral-800 p-2 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-indigo-500"
      />
      <div className="mt-2 flex items-center gap-3 text-xs text-neutral-400">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={skipHooks}
            onChange={(e) => {
              setSkipHooks(e.target.checked);
              setSkipHooksDefault(e.target.checked);
            }}
          />
          Skip hooks
        </label>
        <div className="flex-1" />
        <span>
          {staged.length} file{staged.length === 1 ? "" : "s"}
        </span>
      </div>
      <button
        onClick={commit}
        disabled={!canCommit}
        title={
          conflictsRemaining
            ? "Resolve all conflicts before continuing the merge"
            : undefined
        }
        className="mt-2 w-full rounded-md bg-indigo-600 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy
          ? "Committing…"
          : mergeInProgress
            ? "Continue merge"
            : amend
              ? "Commit (Amend)"
              : "Commit"}
      </button>
    </div>
  );
}
