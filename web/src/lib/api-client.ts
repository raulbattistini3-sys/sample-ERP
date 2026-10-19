import axios, { AxiosError } from "axios";
import { clearSession, getToken } from "./auth-storage";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // e.g. http://localhost:3333
  headers: { "Content-Type": "application/json" },
});

// attach token to every outgoing request
apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// centralize "token expired/invalid" handling — one place, not every hook
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // a 401 from /user/login is just wrong credentials — let the login page show it instead of reloading
    const isLoginRequest = error.config?.url?.endsWith("/user/login");
    if (error.response?.status === 401 && !isLoginRequest) {
      clearSession();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

// API errors come back as { message, status } from BaseErrorMiddleware
export const getApiErrorMessage = (error: unknown, fallback = "Algo deu errado. Tente novamente.") => {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    if (!error.response) return "Não foi possível conectar ao servidor.";
    return error.response.data?.message || fallback;
  }
  return fallback;
};
