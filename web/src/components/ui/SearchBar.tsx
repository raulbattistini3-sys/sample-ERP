import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type SearchField = { value: string; label: string; placeholder: string };

type Props = {
  fields: SearchField[];
  field: string;
  text: string;
  onChange: (text: string, field: string) => void;
};

const DEBOUNCE_MS = 300;

// A search box with a choice of what it searches (e.g. Nome or SKU). Typing waits a moment before it
// searches, so each keystroke doesn't start a request; Enter searches at once, Escape clears.
export function SearchBar({ fields, field, text, onChange }: Props) {
  const [draft, setDraft] = useState(text);
  // the chosen field is local too: with an empty box the URL has no field to hold, and a choice kept only
  // there could never be made before typing (clicking SKU on an empty box did nothing)
  const [chosen, setChosen] = useState(field);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = fields.find((f) => f.value === chosen) ?? fields[0];

  // the URL is the source of truth: back/forward or "Limpar filtros" changes it from outside
  useEffect(() => setDraft(text), [text]);
  // only a URL with a search says which field; clearing the box keeps the choice made
  useEffect(() => {
    if (text) setChosen(field);
  }, [text, field]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (value: string, by = current.value) => {
    clearTimeout(timer.current);
    if (value.trim() !== text || by !== field) onChange(value.trim(), by);
  };

  return (
    <div role="search" className="flex h-8 items-center rounded-md border border-border bg-surface focus-within:ring-2 focus-within:ring-accent/40">
      <div className="flex h-full items-center border-r border-border p-0.5" role="radiogroup" aria-label="Buscar por">
        {fields.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={f.value === current.value}
            onClick={() => {
              setChosen(f.value);
              if (draft.trim()) commit(draft, f.value);
            }}
            className={cn(
              "h-full rounded px-2 text-xs font-medium transition-colors",
              f.value === current.value ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="flex h-full items-center gap-1.5 px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        <input
          type="search"
          value={draft}
          maxLength={100}
          placeholder={current.placeholder}
          aria-label={`Buscar por ${current.label.toLowerCase()}`}
          onChange={(e) => {
            const value = e.target.value;
            setDraft(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(value), DEBOUNCE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
            if (e.key === "Escape") {
              setDraft("");
              commit("");
            }
          }}
          className="w-44 bg-transparent text-sm text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {draft && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              commit("");
            }}
            className="rounded p-0.5 text-muted hover:text-ink"
            aria-label="Limpar busca"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </label>
    </div>
  );
}
