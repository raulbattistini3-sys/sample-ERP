import axios, { AxiosError } from "axios";
import { clearSession, getToken } from "./auth-storage";
import { SocketRequestError } from "./productSocket";
import { acaoDe, CAPTCHA_HEADER, tokenHumano } from "./recaptcha";

export const apiClient = axios.create({
  // "/api" behind the launcher's gateway (same origin); a full address, e.g. http://localhost:3333, when
  // the web talks to the API directly (vite dev server, Docker)
  baseURL: import.meta.env.VITE_API_URL,
  headers: { "Content-Type": "application/json" },
  // arrays as repeated keys (?categoria=A&categoria=B), the form the list filters read; axios's default
  // would send categoria[]=A
  paramsSerializer: { indexes: null },
});

// 128 random bits as hex. crypto.getRandomValues, unlike randomUUID, also works on plain-http pages.
const newIdempotencyKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// attach token to every outgoing request
apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // One key per call: if the same request reaches the gateway twice (a retry, or a replay by someone in
  // the middle), it runs once; a replay with a changed body is refused (network/gateway).
  // The API ignores the header when called directly.
  if (config.method?.toLowerCase() === "post" && !config.headers["Idempotency-Key"]) {
    config.headers["Idempotency-Key"] = newIdempotencyKey();
  }
  return config;
});

// centralize "token expired/invalid" handling — one place, not every hook
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ captcha?: boolean; siteKey?: string }>) => {
    // the network gateway wants proof of a human (login, or after a flood of requests): get an invisible
    // reCAPTCHA v3 token and repeat the request once with it (same Idempotency-Key, so it still runs once)
    const config = error.config;
    if (error.response?.status === 428 && error.response.data?.captcha && config && !config.headers[CAPTCHA_HEADER]) {
      try {
        config.headers[CAPTCHA_HEADER] = await tokenHumano(acaoDe(config.method, config.url), error.response.data.siteKey);
      } catch {
        return Promise.reject(error);
      }
      return apiClient.request(config);
    }
    // a 401 from /user/login is just wrong credentials — let the login page show it instead of reloading
    const isLoginRequest = error.config?.url?.endsWith("/user/login");
    if (error.response?.status === 401 && !isLoginRequest) {
      clearSession();
      // expired, deactivated, or the senha was changed (reset / admin): the login page says so
      window.location.href = "/login?sessao=encerrada";
    }
    return Promise.reject(error);
  },
);

// API errors come back as { message, status } from BaseErrorMiddleware
export const getApiErrorMessage = (error: unknown, fallback = "Algo deu errado. Tente novamente.") => {
  // the product list's socket answers with the same messages as REST
  if (error instanceof SocketRequestError) return error.message || fallback;
  if (axios.isAxiosError<{ message?: string }>(error)) {
    if (!error.response) return "Não foi possível conectar ao servidor.";
    return error.response.data?.message || fallback;
  }
  return fallback;
};

// list endpoints wrap rows as BaseMessageGet, single-item endpoints as BaseMessageGetOne
export type ListResponse<T> = { data: T[]; pageNumber: number; pageSize: number; totalItems: number };
export type ItemResponse<T> = { data: T };
