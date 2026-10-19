import { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function LoadingState({ label = "Carregando..." }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorAlert({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// white card that wraps every create/edit form
export function FormCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("max-w-2xl rounded-lg border border-border bg-surface p-6", className)}>{children}</div>;
}

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        active ? "bg-accent-soft text-accent" : "bg-canvas text-muted",
      )}
    >
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}
