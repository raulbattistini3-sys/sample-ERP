import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getUsuarioById, loginUsuario } from "../features/usuarios/api/usuario.api";
import { LoginUsuarioPayload, Usuario } from "../features/usuarios/types/usuario.types";
import { clearSession, loadStoredUser, saveSession, saveStoredUser } from "../lib/auth-storage";

type AuthContextValue = {
  user: Usuario | null;
  isAuthenticated: boolean;
  login: (payload: LoginUsuarioPayload) => Promise<Usuario>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(loadStoredUser);
  const userId = user?.id;

  // the stored user is a snapshot from login; reload it so changes made on the server since
  // (permissoes, nome, being deactivated) apply without logging out and back in
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getUsuarioById(userId)
      .then((fresh) => {
        if (cancelled) return;
        if (!fresh.ativo) {
          clearSession();
          setUser(null);
          return;
        }
        saveStoredUser(fresh);
        setUser(fresh);
      })
      .catch(() => {
        // offline or a transient error: keep the stored user; a 401 is handled by the api client
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const login = async (payload: LoginUsuarioPayload) => {
    const { token, ...loggedUser } = await loginUsuario(payload);
    saveSession(token, loggedUser);
    setUser(loggedUser);
    return loggedUser;
  };

  const logout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
