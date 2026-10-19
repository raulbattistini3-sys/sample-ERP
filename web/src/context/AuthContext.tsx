import { createContext, useContext, useState, ReactNode } from "react";
import { loginUsuario } from "../features/usuarios/api/usuario.api";
import { LoginUsuarioPayload, Usuario } from "../features/usuarios/types/usuario.types";
import { clearSession, loadStoredUser, saveSession } from "../lib/auth-storage";

type AuthContextValue = {
  user: Usuario | null;
  isAuthenticated: boolean;
  login: (payload: LoginUsuarioPayload) => Promise<Usuario>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(loadStoredUser);

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
