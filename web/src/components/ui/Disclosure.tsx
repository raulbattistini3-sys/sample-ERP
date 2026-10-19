import { useState, ReactNode } from "react";

type DisclosureProps = {
  defaultOpen?: boolean;
  children: (state: { open: boolean; toggle: () => void; close: () => void }) => ReactNode;
};

export function Disclosure({ defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return <>{children({ open, toggle: () => setOpen((o) => !o), close: () => setOpen(false) })}</>;
}
