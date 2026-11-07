import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

// A list's multi-select filters, kept in the URL as repeated keys (?categoria=ELETRONICOS&categoria=INFORMATICA)
// like ?page=, so a reload, back/forward or a shared link shows the same rows. Changing a filter goes back
// to page 1. The API reads the same keys (api/src/utils/schemas/list_filters.schema.ts).
export function useListFilters<K extends string>(keys: readonly K[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const serialized = keys.map((k) => searchParams.getAll(k).join("\u0000")).join("\u0001");

  const filters = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, searchParams.getAll(k)])) as Record<K, string[]>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- serialized captures every value that matters
    [serialized],
  );

  const setFilter = useCallback(
    (key: K, values: string[]) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(key);
          values.forEach((v) => next.append(key, v));
          next.delete("page");
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  // several keys in one URL change, e.g. both ends of a period
  const setFilters = useCallback(
    (updates: Partial<Record<K, string[]>>) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, values] of Object.entries(updates) as [K, string[] | undefined][]) {
            next.delete(key);
            values?.forEach((v) => next.append(key, v));
          }
          next.delete("page");
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );

  const clear = useCallback(
    () =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          keys.forEach((k) => next.delete(k));
          next.delete("page");
          return next;
        },
        { replace: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys is a constant per list
    [setSearchParams],
  );

  const active = keys.some((k) => filters[k].length > 0);
  // only the filters in use: stable query keys and short request URLs
  const params = useMemo(
    () => Object.fromEntries(keys.filter((k) => filters[k].length > 0).map((k) => [k, filters[k]])) as Partial<Record<K, string[]>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from filters
    [filters],
  );

  return { filters, params, setFilter, setFilters, clear, active };
}

export type ListFilterParams = Partial<Record<string, string[]>>;
