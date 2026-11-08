import { create } from "zustand";
import { useSessionStore } from "../../../stores/session.store";
import { createProductEngine, ProductEngine } from "./productEngine";

// The local search engine as a Zustand store: built once from a snapshot and kept while the user moves
// between pages, so coming back to Produtos searches at once. A new snapshot (products changed) builds a
// new engine and only then retires the old one, so searches never stop in between. Signing out (or in as
// someone else, who may see other products) throws it away.

type Status = "idle" | "loading" | "ready" | "error";

type ProductSearchState = {
  status: Status;
  engine: ProductEngine | null;
  error: string | null;
  load: (buffer: ArrayBuffer, etag: string | null) => Promise<void>;
  reset: () => void;
};

// bumps on every load and reset, so a slow build that finishes after a newer one (or after sign-out) is dropped
let generation = 0;

export const useProductSearchStore = create<ProductSearchState>()((set, get) => ({
  status: "idle",
  engine: null,
  error: null,

  load: async (buffer, etag) => {
    const current = get().engine;
    // the browser revalidated the snapshot (304) and handed back the same bytes
    if (current && etag && current.etag === etag) return;
    const mine = ++generation;
    if (!current) set({ status: "loading", error: null });
    try {
      const engine = await createProductEngine(buffer, etag);
      if (mine !== generation) {
        engine.dispose();
        return;
      }
      set({ status: "ready", engine, error: null });
      current?.dispose();
    } catch (err) {
      if (mine !== generation) return;
      // the list keeps working from the server; the old engine, if any, stays in use
      set({ status: current ? "ready" : "error", error: String(err) });
    }
  },

  reset: () => {
    generation++;
    get().engine?.dispose();
    set({ status: "idle", engine: null, error: null });
  },
}));

useSessionStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id) useProductSearchStore.getState().reset();
});
