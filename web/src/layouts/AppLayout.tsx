import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
// @ts-ignore
import { Topbar } from "./Topbar";

const pageTitles: Record<string, string> = {
  "/products": "Produtos",
  "/categorias": "Categorias",
  "/usuarios": "Usuários",
  "/auditoria": "Auditoria",
};

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();
  const title = pageTitles[pathname] ?? "ERP Estoque";

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar className="hidden md:flex" />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <Sidebar className="relative z-50 flex" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
