import { useEffect } from "react";
import { getUsuarioById } from "../features/usuarios/api/usuario.api";
import { useRefreshSessionOnActivity } from "../hooks/useRefreshSessionOnActivity";
import { useSessionStore } from "../stores/session.store";

// What the AuthProvider used to do besides holding the user, mounted once at the root (main.tsx). Renders
// nothing; with the user in a store there is no provider to wrap the app in.
export function SessionSync() {
  const userId = useSessionStore((s) => s.user?.id);
  const setUser = useSessionStore((s) => s.setUser);
  const logout = useSessionStore((s) => s.logout);
  const applySession = useSessionStore((s) => s.applySession);

  // the stored user is a snapshot from login; reload it so changes made on the server since (permissoes,
  // nome, being deactivated) apply without logging out and back in
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getUsuarioById(userId)
      .then((fresh) => {
        if (cancelled) return;
        if (!fresh.ativo) logout();
        else setUser(fresh);
      })
      .catch(() => {
        // offline or a transient error: keep the stored user; a 401 is handled by the api client
      });
    return () => {
      cancelled = true;
    };
  }, [userId, setUser, logout]);

  // the sliding session; the refreshed session also carries the current user, so role changes land too
  useRefreshSessionOnActivity(!!userId, applySession);

  return null;
}
