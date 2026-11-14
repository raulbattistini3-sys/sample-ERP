import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  // while saving, Esc and the backdrop don't close it (the request would finish unseen)
  busy?: boolean;
  size?: "md" | "lg";
};

// A native <dialog> opened with showModal(): the browser traps focus inside, makes the page behind inert,
// closes on Esc and puts focus back where it was. Clicking the backdrop closes it too.
export function Modal({ open, onClose, title, description, children, footer, busy = false, size = "md" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        // the dialog element itself is only hit on its backdrop; the panel covers the rest
        if (event.target === ref.current && !busy) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40",
        size === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-base font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Fechar"
              className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
