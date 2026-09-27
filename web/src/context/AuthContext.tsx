import { createContext, useContext, useState, ReactNode } from "react";
import { apiClient } from "../lib/api-client";

type User = {
  id: string;
  nome: string;
  email: string;
  permissoes: "ADM" | "Estoque";
  ativo: boolean;
};

type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = async (email: string, senha: string) => {
    const { data } = await apiClient.post("/user/login", { email, senha });
    localStorage.setItem("token", data.token);
    setUser(data); // matches ResponseLoginUsuarioDto
  };

  const logout = () => {
    localStorage.removeItem("token");
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
