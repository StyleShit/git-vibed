import { useEffect, useState } from "react";
import { useRepo } from "../../stores/repo";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { unwrap } from "../../lib/ipc";

export function CommitPanel() {
  const { status, refreshAll } = useRepo();
  const toast = useUI((s) => s.toast);
  const skipHooksDefault = useSettings((s) => s.skipHooksByDefault);
  const setSkipHooksDefault = useSettings((s) => s.setSkipHooksByDefault);

  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [skipHooks, setSkipHooks] = useState(skipHooksDefault);
  const [busy, setBusy] = useState(false);
  const [prevMessageCache, setPrevMessageCache] = useState<string>("");
  const [savedMessage, setSavedMessage] = useState<string>(""); // restore point for toggling amend off

  const staged = status?.staged ?? [];
  const canCommit = !busy && message.trim().length > 0 && (amend || staged.length > 0);

  // When amend toggles on, preload the message textarea with the last commit's
  // message. When toggling off, restore whatever was there before.
  useEffect(() => {
    void (async () => {
      if (amend) {
        setSavedMessage(message);
        let prev = prevMessageCache;
        if (!prev) {
          // No cached value — fetch via a hidden op on git log -1.
          // Reuse configGet path is wrong; use a lightweight fetch of the last
          // commit subject+body through a dedicated executor call.
          // (Kept simple — fetch once, cache forever.)
          const res = await window.gitApi.log({ limit: 1, all: false });
          if (res.ok && res.data[0]) {
            prev = res.data[0].subject + (res.data[0].body ? "\n\n" + res.data[0].body : "");
            setPrevMessageCache(prev);
          }
        }
        setMessage(prev);
      } else if (savedMessage !== "") {
        setMessage(savedMessage);
        setSavedMessage("");
      } else {
        setMessage("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend]);

  // Keyboard shortcut (Cmd/Ctrl+Enter) triggered from the global hook.
  useEffect(() => {
    function onCommit() {
      if (canCommit) void commit();
    }
    window.addEventListener("gitgui:commit", onCommit);
    return () => window.removeEventListener("gitgui:commit", onCommit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCommit, message, amend, skipHooks]);

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    try {
      await unwrap(
        window.gitApi.commit({
          message,
          amend,
          noVerify: skipHooks,
        }),
      );
      toast("success", amend ? "Commit amended" : "Committed");
      setMessage("");
      setAmend(false);
      await refreshAll();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-925 p-3">
      <div className="relative">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={amend ? "Amend commit message…" : "Commit message"}
          rows={4}
          className="mono w-full resize-none rounded bg-neutral-800 p-2 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-indigo-500"
        />
        {/* Visual guide past 72 chars on the first line — a subtle shaded box.
            We approximate the glyph-width since the textarea uses a mono font. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 p-2 opacity-40"
          style={{
            background:
              "linear-gradient(to right, transparent calc(72ch + 8px), rgba(239,68,68,0.08) calc(72ch + 8px))",
          }}
        />
      </div>
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
        className="mt-2 w-full rounded-md bg-indigo-600 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Committing…" : amend ? "Commit (Amend)" : "Commit"}
      </button>
    </div>
  );
}
