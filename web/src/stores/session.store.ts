import { create } from "zustand";
import { loginUsuario } from "../features/usuarios/api/usuario.api";
import { LoginResponse, LoginUsuarioPayload, Usuario } from "../features/usuarios/types/usuario.types";
import { clearSession, loadStoredUser, saveSession, saveStoredUser } from "../lib/auth-storage";
import { queryClient } from "../lib/query-client";

// The signed-in usuario, as a Zustand store instead of a React Context: a component subscribes to the slice
// it reads (hooks/useSession.ts), so a sign-in or a refreshed token re-renders the components that show the
// user, not every component below a provider.
//
// localStorage stays the source the session is restored from (lib/auth-storage.ts, the same "token" and
// "user" keys as before), so open sessions survive the switch, and the api client's 401 handling, which
// clears storage and reloads the page, keeps working without knowing about the store.

type SessionState = {
  user: Usuario | null;
  // a session the API handed back: login, the sliding refresh, a password change (which ends the old token)
  applySession: (session: LoginResponse) => void;
  // the same user, reloaded from the server (role or name changed, still signed in)
  setUser: (user: Usuario) => void;
  login: (payload: LoginUsuarioPayload) => Promise<Usuario>;
  logout: () => void;
};

export const useSessionStore = create<SessionState>()((set, get) => ({
  user: loadStoredUser(),

  applySession: ({ token, ...user }) => {
    saveSession(token, user);
    set({ user });
  },

  setUser: (user) => {
    saveStoredUser(user);
    set({ user });
  },

  login: async (payload) => {
    const session = await loginUsuario(payload);
    get().applySession(session);
    return get().user!;
  },

  logout: () => {
    clearSession();
    // drop cached lists so the next person to sign in on this tab never sees them
    queryClient.clear();
    set({ user: null });
  },
}));
