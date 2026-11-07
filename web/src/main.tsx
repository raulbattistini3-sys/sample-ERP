import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./routes/router";
import { queryClient } from "./lib/query-client";
import { SessionSync } from "./components/SessionSync";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* the session lives in a Zustand store (stores/session.store.ts); this keeps it in sync */}
      <SessionSync />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
