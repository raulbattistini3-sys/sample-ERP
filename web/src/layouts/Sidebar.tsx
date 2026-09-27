import { Package, Tags, Users, ClipboardList, LogOut } from "lucide-react";
import { NavItem } from "../components/ui/NavItem";
import { Avatar } from "../components/ui/Avatar";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";

const navItems = [
  { to: "/products", label: "Produtos", icon: Package, requiresAdm: false },
  { to: "/categorias", label: "Categorias", icon: Tags, requiresAdm: false },
  { to: "/usuarios", label: "Usuários", icon: Users, requiresAdm: true },
  { to: "/auditoria", label: "Auditoria", icon: ClipboardList, requiresAdm: false },
];

type SidebarProps = { className?: string };

export function Sidebar({ className }: SidebarProps) {
  const { user, logout } = useAuth();
  const visibleItems = navItems.filter((item) => !item.requiresAdm || user?.permissoes === "ADM");

  return (
    <aside className={cn("flex h-full w-60 flex-col border-r border-border bg-surface", className)}>
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="h-6 w-6 rounded-sm bg-accent" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink">ERP Estoque</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <Avatar name={user?.nome ?? "?"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{user?.nome}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Sair"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
