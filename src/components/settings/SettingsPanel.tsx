import { useEffect, useMemo, useState } from "react";
import { Select } from "@base-ui-components/react/select";
import { unwrap } from "../../lib/ipc";
import { useUI } from "../../stores/ui";
import { useActiveTab } from "../../stores/repo";
import { useSettings } from "../../stores/settings";
import { CheckIcon, ChevronDownIcon, CloseIcon } from "../ui/Icons";
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
        <SettingSelect
          value={theme}
          onValueChange={setTheme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "system", label: "Follow system" },
          ]}
        />
      </Field>
      <Field label="Auto-fetch interval">
        <SettingSelect
          value={autoFetchIntervalMs}
          onValueChange={setAutoFetchIntervalMs}
          options={[
            { value: 60_000, label: "1 minute" },
            { value: 5 * 60_000, label: "5 minutes" },
            { value: 15 * 60_000, label: "15 minutes" },
            { value: 60 * 60_000, label: "1 hour" },
          ]}
        />
      </Field>
      <Field label="Default pull strategy">
        <SettingSelect
          value={defaultPullStrategy}
          onValueChange={setDefaultPullStrategy}
          options={[
            { value: "merge", label: "Merge" },
            { value: "rebase", label: "Rebase" },
            { value: "ff-only", label: "Fast-forward only" },
          ]}
        />
      </Field>
    </section>
  );
}

function SettingSelect<T extends string | number>({
  value,
  onValueChange,
  options,
  width = 160,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  width?: number;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      items={options}
    >
      <Select.Trigger
        style={{ width }}
        className="flex items-center justify-between gap-2 rounded bg-neutral-800 px-2 py-1 text-sm outline-none hover:bg-neutral-700 data-[popup-open]:bg-neutral-700"
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDownIcon className="size-3 text-neutral-400" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          sideOffset={4}
          className="z-50 outline-none"
          style={{ minWidth: width }}
        >
          <Select.Popup className="max-h-[--available-height] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900 py-1 text-sm shadow-lg outline-none">
            {options.map((o) => (
              <Select.Item
                key={String(o.value)}
                value={o.value}
                className="flex cursor-default items-center gap-2 px-3 py-1.5 outline-none data-[highlighted]:bg-neutral-800"
              >
                <span className="flex size-3 items-center justify-center">
                  <Select.ItemIndicator>
                    <CheckIcon className="size-3 text-indigo-400" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function GitConfigPanel() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const toast = useUI((s) => s.toast);
  const activePath = useActiveTab()?.path ?? "";
  const [scope, setScope] = useState<"local" | "global">("local");

  async function refresh() {
    try {
      const list = await unwrap(window.gitApi.configList(activePath));
      setEntries(list);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

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
          <SettingSelect
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "local", label: "Local (repo)" },
              { value: "global", label: "Global" },
            ]}
            width={140}
          />
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
