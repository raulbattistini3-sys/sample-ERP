import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";

const controlStyles =
  "w-full rounded-md border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted " +
  "focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:bg-canvas disabled:text-muted";
const invalidStyles = "border-red-400 focus:border-red-500 focus:ring-red-200";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

// label + control + error message; pass the same id to the control so aria-describedby lines up
export function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

type ControlProps = { invalid?: boolean };

const ariaFor = (id: string | undefined, invalid?: boolean) => ({
  "aria-invalid": invalid || undefined,
  "aria-describedby": invalid && id ? `${id}-error` : undefined,
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & ControlProps>(
  ({ invalid, className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(controlStyles, "h-10", invalid && invalidStyles, className)}
      {...ariaFor(props.id, invalid)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & ControlProps>(
  ({ invalid, className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(controlStyles, "h-10", invalid && invalidStyles, className)}
      {...ariaFor(props.id, invalid)}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps>(
  ({ invalid, className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(controlStyles, "min-h-24 py-2", invalid && invalidStyles, className)}
      {...ariaFor(props.id, invalid)}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
