import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

type PaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
};

type PageItem = number | "ellipsis-start" | "ellipsis-end";

// how many page numbers sit on each side of the current one
const SIBLINGS = 1;
// first + last + current + siblings + two ellipsis slots
const MAX_ITEMS = 5 + SIBLINGS * 2;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// 1 2 3 4 5 … 20  /  1 … 9 10 11 … 20  /  1 … 16 17 18 19 20
const getPageItems = (page: number, totalPages: number): PageItem[] => {
  if (totalPages <= MAX_ITEMS) return range(1, totalPages);

  const left = Math.max(page - SIBLINGS, 2);
  const right = Math.min(page + SIBLINGS, totalPages - 1);
  const showStartEllipsis = left > 3;
  const showEndEllipsis = right < totalPages - 2;
  // keep the row the same width near the edges instead of shrinking it
  const edgeCount = MAX_ITEMS - 2;

  if (!showStartEllipsis) return [...range(1, edgeCount), "ellipsis-end", totalPages];
  if (!showEndEllipsis) return [1, "ellipsis-start", ...range(totalPages - edgeCount + 1, totalPages)];
  return [1, "ellipsis-start", ...range(left, right), "ellipsis-end", totalPages];
};

export const Pagination = ({ page, pageSize, totalItems, onPageChange }: PaginationProps) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-center gap-1 text-sm">
      <Button variant="ghost" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Anterior</span>
      </Button>

      {getPageItems(page, totalPages).map((item) =>
        typeof item === "number" ? (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            aria-current={item === page ? "page" : undefined}
            aria-label={`Página ${item}`}
            className={cn(
              "h-8 min-w-8 rounded-md px-2 font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              item === page ? "bg-accent text-white" : "text-muted hover:bg-canvas hover:text-ink",
            )}
          >
            {item}
          </button>
        ) : (
          <span key={item} className="px-1 text-muted" aria-hidden="true">
            …
          </span>
        ),
      )}

      <Button variant="ghost" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
        <span className="hidden sm:inline">Próxima</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </nav>
  );
};
