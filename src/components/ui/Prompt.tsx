import { useState } from "react";
import { Dialog } from "./Dialog";

export function Prompt({
  title,
  label,
  defaultValue = "",
  placeholder,
  submitLabel = "OK",
  onSubmit,
  onCancel,
}: {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Dialog title={title} onClose={onCancel}>
      {label && <label className="mb-1 block text-xs text-neutral-400">{label}</label>}
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        className="mb-4 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded px-3 py-1.5 text-sm hover:bg-neutral-800">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </Dialog>
  );
}
