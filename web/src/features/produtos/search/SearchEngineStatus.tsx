import type { LocalRun } from "./useLocalProducts";
import { SHOW_SEARCH_TIMINGS } from "../../../lib/ambiente";

type Props = {
  mode: "server" | "loading" | "local";
  run: LocalRun | null;
};

// SHOW_SEARCH_TIMINGS: VITE_SEARCH_TIMINGS=true|false, unset: on in a dev.* environment (lib/ambiente.ts)
const count = new Intl.NumberFormat("pt-BR");
const ms = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const PLACE = { main: "nesta aba", worker: "em segundo plano" } as const;

// Under the filters:
// - the timing line (dev and experiments only): where results come from and, for local searches, how
//   many matched, how long it took and where it ran. Hidden in production, but the element stays with
//   its data-* attributes, which the e2e tests and experiments read.
// - the guesses (always): a word with no exact match was matched by similarity, and the user should know
//   which word it was taken for, so a guess never looks like an exact result.
export function SearchEngineStatus({ mode, run }: Props) {
  const local = mode === "local" && run !== null;
  const guesses = local ? run.guesses : [];
  const text = local
    ? `${count.format(run.matched)} de ${count.format(run.total)} produtos · ${ms.format(run.totalMs)} ms ${PLACE[run.target]}`
    : mode === "loading"
      ? "Preparando a busca instantânea…"
      : "Busca no servidor";

  return (
    <div className={SHOW_SEARCH_TIMINGS || guesses.length > 0 ? "mb-3 -mt-2 space-y-0.5 text-xs text-muted" : undefined}>
      <p
        hidden={!SHOW_SEARCH_TIMINGS}
        data-testid="search-engine-status"
        data-mode={local ? "local" : mode}
        data-target={local ? run.target : undefined}
        data-matched={local ? run.matched : undefined}
        data-fuzzy={local ? String(guesses.length > 0) : undefined}
      >
        {text}
      </p>
      {guesses.length > 0 && (
        <p data-testid="search-guesses" aria-live="polite">
          Resultados aproximados, os mais parecidos primeiro:{" "}
          {guesses.map((g, i) => (
            <span key={g.word}>
              {i > 0 && ", "}
              <s>{g.word}</s> → <b className="font-medium text-ink">{g.term}</b>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
