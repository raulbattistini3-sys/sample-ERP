import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../stores/session.store";

// Session hooks. Each subscribes to the narrowest slice it can: a page that only checks the role
// re-renders when the user changes, and one that only needs logout never re-renders for the session.

export const useUser = () => useSessionStore((s) => s.user);

export const useIsAuthenticated = () => useSessionStore((s) => s.user !== null);

/** Stable action references (store functions never change). */
export const useSessionActions = () =>
  useSessionStore(useShallow((s) => ({ login: s.login, logout: s.logout, applySession: s.applySession })));
