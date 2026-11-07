import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type FilterOption = { value: string; label: string };

type Props = {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
};

// A filter button that opens a checklist: pick any number of values (e.g. categorias ELETRONICOS and
// INFORMATICA) and the list shows rows matching any of them. Long lists get a search box. Escape or a
// click outside closes it; the choice applies as you tick, like a spreadsheet's column filter.
export function MultiSelectFilter({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const searchable = options.length > 8;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const visible = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [busca, options]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selecionados`;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        // spelled out: the two spans below would read "Categoria : 2 selecionados"
        aria-label={summary ? `${label}: ${summary}` : label}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
          selected.length > 0
            ? "border-accent bg-accent-soft text-ink"
            : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
        )}
      >
        {/* one span, so the button's gap doesn't land between the label and its colon */}
        <span className="max-w-[14rem] truncate">
          <span className="font-medium text-ink">{label}</span>
          {summary && `: ${summary}`}
        </span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={listId}
          role="group"
          aria-label={`Filtrar por ${label}`}
          className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {searchable && (
            <label className="mb-1 flex items-center gap-2 border-b border-border px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar..."
                aria-label={`Buscar em ${label}`}
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
            </label>
          )}
          <ul className="max-h-64 overflow-y-auto">
            {visible.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <li key={option.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-canvas">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={checked}
                      onChange={() => toggle(option.value)}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
                        checked ? "border-accent bg-accent text-white" : "border-border bg-surface",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">Nada encontrado.</li>}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2 pt-1.5 pb-1 text-xs text-muted hover:text-ink"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Limpar {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// the row of filter buttons under a list's header, with one "clear all"
export function FilterBar({ children, active, onClear }: { children: React.ReactNode; active: boolean; onClear: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
      {children}
      {active && (
        <button type="button" onClick={onClear} className="inline-flex h-8 items-center gap-1 px-2 text-sm text-muted hover:text-ink">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
