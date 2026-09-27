import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // e.g. http://localhost:3333
  headers: { "Content-Type": "application/json" },
});

// attach token to every outgoing request
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// centralize "token expired/invalid" handling — one place, not every hook
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
