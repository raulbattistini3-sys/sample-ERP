import { ReactNode } from "react";

export const inputClassName =
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink " +
  "focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-accent disabled:opacity-50";

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
