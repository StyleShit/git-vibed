import { useEffect, useMemo, useState } from "react";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";
import { useSettings } from "../../stores/settings";
import { CloseIcon } from "../ui/Icons";
import type { ConfigEntry } from "@shared/types";

const COMMON_SETTINGS: Array<{ key: string; label: string; hint?: string }> = [
  { key: "user.name", label: "User Name" },
  { key: "user.email", label: "User Email" },
  { key: "core.autocrlf", label: "core.autocrlf", hint: "true | false | input" },
  { key: "core.editor", label: "core.editor" },
  { key: "pull.rebase", label: "pull.rebase", hint: "true | false" },
  { key: "merge.conflictstyle", label: "merge.conflictstyle", hint: "merge | diff3 | zdiff3" },
  { key: "init.defaultBranch", label: "init.defaultBranch" },
];

export function SettingsPanel() {
  const setView = useUI((s) => s.setView);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-800 bg-neutral-925 px-3 text-xs">
        <span className="text-neutral-500">Settings</span>
        <button
          onClick={() => setView("graph")}
          className="ml-auto rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Close settings (Esc)"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl p-6">
          <h2 className="mb-4 text-lg font-semibold">Settings</h2>
          <AppSettings />
          <GitConfigPanel />
        </div>
      </div>
    </div>
  );
}

function AppSettings() {
  const { theme, autoFetchIntervalMs, defaultPullStrategy, setTheme, setAutoFetchIntervalMs, setDefaultPullStrategy } =
    useSettings();
  return (
    <section className="mb-8 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-3 text-sm font-semibold">App</h3>
      <Field label="Theme">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as typeof theme)}
          className="rounded bg-neutral-800 px-2 py-1 text-sm"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">Follow system</option>
        </select>
      </Field>
      <Field label="Auto-fetch interval">
        <select
          value={autoFetchIntervalMs}
          onChange={(e) => setAutoFetchIntervalMs(Number(e.target.value))}
          className="rounded bg-neutral-800 px-2 py-1 text-sm"
        >
          <option value={60_000}>1 minute</option>
          <option value={5 * 60_000}>5 minutes</option>
          <option value={15 * 60_000}>15 minutes</option>
          <option value={60 * 60_000}>1 hour</option>
        </select>
      </Field>
      <Field label="Default pull strategy">
        <select
          value={defaultPullStrategy}
          onChange={(e) => setDefaultPullStrategy(e.target.value as typeof defaultPullStrategy)}
          className="rounded bg-neutral-800 px-2 py-1 text-sm"
        >
          <option value="merge">Merge</option>
          <option value="rebase">Rebase</option>
          <option value="ff-only">Fast-forward only</option>
        </select>
      </Field>
    </section>
  );
}

function GitConfigPanel() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const toast = useUI((s) => s.toast);
  const [scope, setScope] = useState<"local" | "global">("local");

  async function refresh() {
    try {
      const list = await unwrap(window.gitApi.configList());
      setEntries(list);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byKey = useMemo(() => {
    const map = new Map<string, ConfigEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.key) ?? [];
      arr.push(e);
      map.set(e.key, arr);
    }
    return map;
  }, [entries]);

  async function save(key: string, value: string) {
    try {
      await unwrap(window.gitApi.configSet(key, value, scope));
      toast("success", `Saved ${key}`);
      await refresh();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Git config</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-400">Save to:</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs"
          >
            <option value="local">Local (repo)</option>
            <option value="global">Global</option>
          </select>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th className="pb-2">Key</th>
            <th className="pb-2">Value</th>
            <th className="pb-2">Source</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {COMMON_SETTINGS.map((s) => {
            const existing = byKey.get(s.key) ?? [];
            // Prefer the innermost scope (local > global > system) when showing
            // the active value.
            const effective =
              existing.find((e) => e.scope === "local") ??
              existing.find((e) => e.scope === "global") ??
              existing[0];
            return (
              <EditableRow
                key={s.key}
                label={s.label}
                hint={s.hint}
                k={s.key}
                existing={effective}
                onSave={save}
              />
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function EditableRow({
  label,
  hint,
  k,
  existing,
  onSave,
}: {
  label: string;
  hint?: string;
  k: string;
  existing?: ConfigEntry;
  onSave: (key: string, value: string) => void;
}) {
  const [value, setValue] = useState(existing?.value ?? "");
  useEffect(() => setValue(existing?.value ?? ""), [existing?.value]);
  const dirty = value !== (existing?.value ?? "");
  return (
    <tr className="border-b border-neutral-900">
      <td className="py-1.5 pr-3">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-[11px] text-neutral-500">{hint}</div>}
      </td>
      <td className="py-1.5 pr-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded bg-neutral-800 px-2 py-1 text-sm outline-none"
        />
      </td>
      <td className="py-1.5 pr-3 text-xs text-neutral-500">{existing?.scope ?? "—"}</td>
      <td className="py-1.5">
        <button
          disabled={!dirty}
          onClick={() => onSave(k, value)}
          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700 disabled:opacity-50"
        >
          Save
        </button>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-sm text-neutral-300">{label}</div>
      {children}
    </div>
  );
}
