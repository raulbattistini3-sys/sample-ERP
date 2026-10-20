import { Usuario } from "../features/usuarios/types/usuario.types";

const TOKEN_KEY = "token";
const USER_KEY = "user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const saveSession = (token: string, user: Usuario) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

// keeps the token, replaces the stored user (e.g. after its role changed on the server)
export const saveStoredUser = (user: Usuario) => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

// JWT payload is base64url — only read here to check `exp`, the API is what actually verifies it
const isTokenExpired = (token: string) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
};

// restores the user after a page reload, so ProtectedRoute doesn't bounce a still-valid session
export const loadStoredUser = (): Usuario | null => {
  const token = getToken();
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !rawUser || isTokenExpired(token)) {
    clearSession();
    return null;
  }
  try {
    return JSON.parse(rawUser) as Usuario;
  } catch {
    clearSession();
    return null;
  }
};
