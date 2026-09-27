import { Menu } from "lucide-react";

type TopbarProps = { title: string; onMenuClick: () => void };

export function Topbar({ title, onMenuClick }: TopbarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink md:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <h1 className="text-base font-semibold text-ink">{title}</h1>
    </header>
  );
}
