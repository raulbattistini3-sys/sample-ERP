import { Request } from "express";
import { ValidationError } from "../../errors/client_errors/four_xx.error";
import { Either, left, right } from "../../globals/errors/left_right_either.error";

// Multi-select list filters: ?categoria=ELETRONICOS&categoria=INFORMATICA (the web sends repeated keys)
// or ?categoria=ELETRONICOS,INFORMATICA. Values of one filter are OR-ed, different filters are AND-ed,
// and a filter left out matches everything.

type FilterSpec = {
   label: string;
   // allowed values; anything else is a 400
   values?: readonly string[];
   // instant: one ISO 8601 date-time with its offset, e.g. 2026-11-01T03:00:00.000Z (a period is two)
   kind?: "uuid" | "number" | "instant" | "text";
};

// free text (kind "text"): one value, commas included, up to this many characters
const MAX_TEXT = 100;

export type ListFilters<K extends string> = Partial<Record<K, string[]>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// an ISO 8601 date-time that says which instant it is (Z or an offset); a bare date or local time
// would be read in the server's time zone, not the user's
function isInstant(value: string) {
   return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}
// a filter is a checklist, not a free-form search: more values than this is a mistake
const MAX_VALUES = 50;

export const STATUS_VALUES = ["ativo", "inativo"] as const;

function values(raw: unknown): string[] {
   const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
   return [...new Set(list.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean))];
}

export function parseListFilters<K extends string>(
   query: Request["query"],
   spec: Record<K, FilterSpec>,
): Either<ValidationError, ListFilters<K>> {
   const filters: ListFilters<K> = {};
   for (const key of Object.keys(spec) as K[]) {
      const { label, values: allowed, kind } = spec[key];
      if (kind === "text") {
         const raw = query[key];
         if (Array.isArray(raw) && raw.length > 1) {
            return left(new ValidationError("400", `Informe um único texto em ${label}.`));
         }
         const text = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim() ?? "";
         if (!text) continue;
         if (text.length > MAX_TEXT) {
            return left(new ValidationError("400", `${label} aceita até ${MAX_TEXT} caracteres.`));
         }
         filters[key] = [text];
         continue;
      }
      const list = values(query[key]);
      if (list.length === 0) continue;
      if (kind === "instant" && list.length > 1) {
         return left(new ValidationError("400", `Informe um único instante em ${label}.`));
      }
      if (list.length > MAX_VALUES) {
         return left(new ValidationError("400", `Escolha no máximo ${MAX_VALUES} valores em ${label}.`));
      }
      const invalid = list.find(
         (v) =>
            (allowed && !allowed.includes(v)) ||
            (kind === "uuid" && !UUID.test(v)) ||
            (kind === "number" && !Number.isFinite(Number(v))) ||
            (kind === "instant" && !isInstant(v)),
      );
      if (invalid !== undefined) {
         const hint = allowed ? ` Valores aceitos: ${allowed.join(", ")}.` : kind === "instant" ? " Use ISO 8601 com fuso, ex.: 2026-11-01T03:00:00Z." : "";
         return left(new ValidationError("400", `Valor inválido em ${label}: "${invalid}".${hint}`));
      }
      filters[key] = list;
   }
   return right(filters);
}

/** A period [desde, antes): a 400 when it ends before it starts. */
export function checkPeriod(desde: string[] | undefined, antes: string[] | undefined, label: string): ValidationError | null {
   if (desde?.[0] && antes?.[0] && Date.parse(desde[0]) >= Date.parse(antes[0])) {
      return new ValidationError("400", `O início de ${label} é depois do fim.`);
   }
   return null;
}

// the text inside a LIKE pattern, with its wildcards taken literally
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => "\\" + c);

export const hasFilters = (filters: ListFilters<string>) => Object.values(filters).some((v) => v && v.length > 0);

// a status filter with both values, or none, is no filter
export function statusFilter(status: string[] | undefined): boolean | undefined {
   if (!status || status.length !== 1) return undefined;
   return status[0] === "ativo";
}

// keeps the rows that pass every given filter
export function matchesAll(checks: (boolean | undefined)[]): boolean {
   return checks.every((c) => c !== false);
}

export const inList = (list: string[] | undefined, value: string) => (list ? list.includes(value) : undefined);
