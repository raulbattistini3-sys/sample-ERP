import { NavLink } from "react-router-dom";
import { ComponentType, SVGProps } from "react";
import { cn } from "../../lib/cn";

type NavItemProps = {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export function NavItem({ to, label, icon: Icon }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "border-accent bg-accent-soft text-accent"
            : "border-transparent text-muted hover:bg-canvas hover:text-ink",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </NavLink>
  );
}
