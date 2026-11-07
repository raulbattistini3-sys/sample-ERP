import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "../../lib/cn";

// Days are "YYYY-MM-DD" strings in the browser's calendar, never Date objects across renders, so no
// time zone can move a day.
type Day = string;

type Props = {
  label: string;
  from?: Day;
  to?: Day;
  onChange: (from: Day | undefined, to: Day | undefined) => void;
};

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
// "novembro de 2026" → "Novembro de 2026" (CSS capitalize would also make it "De")
const monthName = (d: Date) => {
  const s = monthFormat.format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fullDay = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" });

const pad = (n: number) => String(n).padStart(2, "0");
const toDay = (d: Date): Day => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (day: Day, n: number) => {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
export const formatDay = (day: Day) => day.split("-").reverse().join("/");
/** The instant this day (plus `plusDays`) starts in the browser's time zone, as ISO 8601. */
export const localMidnight = (day: Day, plusDays = 0) => fromDay(addDays(day, plusDays)).toISOString();

function presets(today: Day): { label: string; from: Day; to: Day }[] {
  const t = fromDay(today);
  const firstOfMonth = toDay(new Date(t.getFullYear(), t.getMonth(), 1));
  const lastMonthStart = toDay(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const lastMonthEnd = toDay(new Date(t.getFullYear(), t.getMonth(), 0));
  return [
    { label: "Hoje", from: today, to: today },
    { label: "Últimos 7 dias", from: addDays(today, -6), to: today },
    { label: "Últimos 30 dias", from: addDays(today, -29), to: today },
    { label: "Este mês", from: firstOfMonth, to: today },
    { label: "Mês passado", from: lastMonthStart, to: lastMonthEnd },
    { label: "Este ano", from: `${t.getFullYear()}-01-01`, to: today },
  ];
}

// the 6 weeks shown for a month, starting on Sunday
function monthGrid(year: number, month: number): Day[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => toDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

// A period picker like a booking calendar: the first click marks where the period starts, the span
// follows the pointer, and the second click closes it (either order works). Presets cover the usual
// periods. Both days are included.
export function DateRangeFilter({ label, from, to, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Day | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  const today = toDay(new Date());
  const [view, setView] = useState(() => fromDay(from ?? today));
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  // a half-made selection is dropped when the panel closes
  useEffect(() => {
    if (!open) {
      setAnchor(null);
      setHover(null);
    }
  }, [open]);

  const grid = useMemo(() => monthGrid(view.getFullYear(), view.getMonth()), [view]);
  const viewMonth = view.getMonth();

  // what's highlighted: the span being drawn, or the chosen period
  const [lo, hi] = anchor
    ? [anchor, hover ?? anchor].sort()
    : [from ?? null, to ?? from ?? null];

  const pick = (day: Day) => {
    if (!anchor) {
      setAnchor(day);
      return;
    }
    const [start, end] = [anchor, day].sort();
    onChange(start, end);
    setOpen(false);
  };

  const shiftMonth = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));

  const summary = from ? (to && to !== from ? `${formatDay(from)} – ${formatDay(to)}` : formatDay(from)) : null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={summary ? `${label}: ${summary}` : label}
        onClick={() => {
          setView(fromDay(from ?? today));
          setOpen((o) => !o);
        }}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
          from ? "border-accent bg-accent-soft text-ink" : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
        {/* one span, so the button's gap doesn't land between the label and its colon */}
        <span className="whitespace-nowrap">
          <span className="font-medium text-ink">{label}</span>
          {summary && `: ${summary}`}
        </span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Escolher período de ${label.toLowerCase()}`}
          className="absolute left-0 z-20 mt-1 flex flex-col gap-3 rounded-md border border-border bg-surface p-3 shadow-lg sm:flex-row"
        >
          <ul className="flex flex-row flex-wrap gap-1 sm:w-36 sm:flex-col" aria-label="Períodos prontos">
            {presets(today).map((p) => (
              <li key={p.label}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.from, p.to);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full rounded px-2 py-1 text-left text-sm hover:bg-canvas",
                    from === p.from && to === p.to ? "font-medium text-accent" : "text-ink",
                  )}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="w-64">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => shiftMonth(-1)} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Mês anterior">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium text-ink" aria-live="polite">
                {monthName(view)}
              </span>
              <button type="button" onClick={() => shiftMonth(1)} className="rounded p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Próximo mês">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-xs text-muted" aria-hidden="true">
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7" onPointerLeave={() => setHover(null)}>
              {grid.map((day) => {
                const inMonth = fromDay(day).getMonth() === viewMonth;
                const inRange = lo !== null && hi !== null && day >= lo && day <= hi;
                const edge = day === lo || day === hi;
                return (
                  <button
                    key={day}
                    type="button"
                    data-day={day}
                    onClick={() => pick(day)}
                    onPointerEnter={() => anchor && setHover(day)}
                    onFocus={() => anchor && setHover(day)}
                    aria-label={fullDay.format(fromDay(day))}
                    aria-pressed={inRange}
                    className={cn(
                      "h-8 text-sm transition-colors",
                      inRange && !edge && "bg-accent-soft text-ink",
                      edge && "rounded-md bg-accent font-medium text-white",
                      !inRange && (inMonth ? "text-ink hover:bg-canvas" : "text-muted/60 hover:bg-canvas"),
                      day === today && !edge && "font-semibold underline underline-offset-4",
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted">
              <span>{anchor ? `De ${formatDay(anchor)}: escolha o fim` : "Clique no início e no fim"}</span>
              {from && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(undefined, undefined);
                    setOpen(false);
                  }}
                  className="inline-flex items-center gap-1 hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
