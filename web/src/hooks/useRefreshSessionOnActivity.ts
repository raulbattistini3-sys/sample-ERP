import { useEffect } from "react";
import { refreshSession } from "../features/usuarios/api/usuario.api";
import { LoginResponse } from "../features/usuarios/types/usuario.types";
import { getTokenIssuedAt } from "../lib/auth-storage";

// tokens last 1h; renewing at most every 5 min of activity keeps an active user signed in,
// while someone who walks away is signed out an hour after their last interaction
const REFRESH_AFTER_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown"] as const;

// one document-level listener covers every page, so no component has to opt in
export function useRefreshSessionOnActivity(enabled: boolean, onRefreshed: (session: LoginResponse) => void) {
  useEffect(() => {
    if (!enabled) return;
    let inFlight = false;

    const handleActivity = () => {
      const issuedAt = getTokenIssuedAt();
      if (inFlight || issuedAt === null || Date.now() - issuedAt < REFRESH_AFTER_MS) return;
      inFlight = true;
      refreshSession()
        .then(onRefreshed)
        // an expired/revoked token comes back 401 and the api client signs the user out
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };

    ACTIVITY_EVENTS.forEach((type) => document.addEventListener(type, handleActivity, { passive: true }));
    return () => ACTIVITY_EVENTS.forEach((type) => document.removeEventListener(type, handleActivity));
  }, [enabled, onRefreshed]);
}
