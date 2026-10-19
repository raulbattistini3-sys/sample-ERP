import { ReactNode } from "react";

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  footer?: ReactNode;
  children: ReactNode;
};

// centered card shared by the public pages (login, register)
export function AuthLayout({ title, subtitle, footer, children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="h-7 w-7 rounded-sm bg-accent" aria-hidden="true" />
          <span className="text-lg font-semibold text-ink">ERP Estoque</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>

        {footer && <p className="mt-4 text-center text-sm text-muted">{footer}</p>}
      </div>
    </main>
  );
}
