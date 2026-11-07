import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../lib/api-client";
import { LAZY_PAGE_SIZE } from "../../../lib/pagination";
import type { ListFilterParams } from "../../../hooks/useListFilters";
import type { Product } from "../types/produto.types";
import { useProductSearchStore } from "./productSearch.store";
import { toOpSpec, toProducts } from "./productQuery";
import type { ProductEngine } from "./productEngine";

type Target = import("@pkg/tablecore/types.js").Target;

export type SnapshotResponse = { buffer: ArrayBuffer; etag: string | null };

// GET /products/snapshot as raw bytes. Under ["products"], so the invalidation every product write already
// does refetches it; the API answers 304 through the browser cache while nothing changed, and the store
// skips a rebuild for the same ETag.
const fetchSnapshot = async (): Promise<SnapshotResponse> => {
  const res = await apiClient.get<ArrayBuffer>("/products/snapshot", { responseType: "arraybuffer" });
  return { buffer: res.data, etag: (res.headers["etag"] as string | undefined) ?? null };
};

// Downloads the snapshot once `enabled` (after the first page is on screen, so the two never compete) and
// keeps the engine built from it. Returns the engine once it's ready, null before or without one.
export function useProductEngine(enabled: boolean) {
  const load = useProductSearchStore((s) => s.load);
  const engine = useProductSearchStore((s) => s.engine);
  const status = useProductSearchStore((s) => s.status);
  const snapshot = useQuery({
    queryKey: ["products", "snapshot"],
    queryFn: fetchSnapshot,
    enabled,
    // bytes, not JSON: nothing to share structurally, and comparing 50 MB would be the slowest part
    structuralSharing: false,
    staleTime: 30_000,
    retry: 1,
  });
  useEffect(() => {
    if (snapshot.data) void load(snapshot.data.buffer, snapshot.data.etag);
  }, [snapshot.data, load]);
  return { engine, status, error: snapshot.error };
}

// a query word the engine matched by similarity, and the closest word it found for it
export type Guess = { word: string; term: string };

export type LocalRun = {
  matched: number;
  total: number;
  target: Target;
  totalMs: number;
  mainBlockedMs: number;
  reason: string;
  guesses: Guess[];
};

type Result = { engine: ProductEngine; params: ListFilterParams; indices: Uint32Array; run: LocalRun };

// The list's filters run by the local engine: filter in the browser, decode only the rows shown, and
// "Carregar mais" just shows more of the same result. `ready` is false until the engine has answered for
// the current filters; the page shows the server's rows until then.
export function useLocalProducts(engine: ProductEngine | null, params: ListFilterParams) {
  const [result, setResult] = useState<Result | null>(null);
  const [count, setCount] = useState(LAZY_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    // a newer run on the same channel makes this one's worker reply stale; it resolves { stale: true }
    engine.scheduler
      .run(toOpSpec(params), { channel: "products" })
      .then((outcome) => {
        // `in` narrows the union even without strictNullChecks (this app compiles with strict: false)
        if (cancelled || !("indices" in outcome)) return;
        setResult({
          engine,
          params,
          indices: outcome.indices,
          run: {
            matched: outcome.indices.length,
            total: engine.dataset.rows,
            target: outcome.target,
            totalMs: outcome.timing.totalMs,
            mainBlockedMs: outcome.timing.mainBlockedMs,
            reason: outcome.decision.reason,
            guesses: (outcome.stats.match?.words ?? [])
              .filter((w) => w.mode === "fuzzy" && w.suggestions.length > 0)
              .map((w) => ({ word: w.word, term: w.suggestions[0].term })),
          },
        });
        setCount(LAZY_PAGE_SIZE);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [engine, params]);

  // the engine answered, but maybe for the previous filters: keep showing that until the new run lands,
  // which is what keeps typing smooth
  const current = result !== null && result.engine === engine && error === null;
  const ready = current && result.params === params;
  const products: Product[] = useMemo(
    () => (current ? toProducts(result.engine.dataset, result.indices, count) : []),
    [current, result, count],
  );

  return {
    // the local engine drives the list (even while a newer run is in flight)
    active: current,
    ready,
    products,
    run: current ? result.run : null,
    hasMore: current && count < result.indices.length,
    loadMore: () => setCount((c) => c + LAZY_PAGE_SIZE),
    error,
  };
}
