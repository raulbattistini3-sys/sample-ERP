import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { Fragment, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { useMobile } from "../../hooks/useMobile";

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;

export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

const EMPTY_DATA: never[] = [];

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[];
  data?: TData[];
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  // on mobile each row becomes a card; this column is its title (defaults to the first column)
  mobileTitleColumnId?: string;
};

// plain-text label for a column on the mobile cards and the sort select
const columnLabel = (header: unknown, fallback: string) => (typeof header === "string" ? header : fallback);

export function DataTable<TData extends RowData>({
  columns,
  data = EMPTY_DATA,
  onRowClick,
  emptyMessage = "Nenhum registro encontrado.",
  mobileTitleColumnId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  // a wide table needs horizontal scrolling on a phone; cards don't
  const isMobile = useMobile();

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
  });

  const rows = table.getRowModel().rows;

  if (isMobile) {
    const sortableColumns = table.getAllLeafColumns().filter((column) => column.getCanSort());
    const sortValue = sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : "";

    return (
      <div className="space-y-2">
        {sortableColumns.length > 0 && rows.length > 1 && (
          <label className="flex items-center justify-end gap-2 text-sm text-muted">
            Ordenar por
            <select
              value={sortValue}
              onChange={(e) => {
                const [id, direction] = e.target.value.split(":");
                setSorting(id ? [{ id, desc: direction === "desc" }] : []);
              }}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Padrão</option>
              {sortableColumns.flatMap((column) => [
                <option key={`${column.id}:asc`} value={`${column.id}:asc`}>
                  {columnLabel(column.columnDef.header, column.id)} ↑
                </option>,
                <option key={`${column.id}:desc`} value={`${column.id}:desc`}>
                  {columnLabel(column.columnDef.header, column.id)} ↓
                </option>,
              ])}
            </select>
          </label>
        )}

        {rows.length === 0 && (
          <p className="rounded-md border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
            {emptyMessage}
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row) => {
            const cells = row.getAllCells();
            const titleCell = cells.find((cell) => cell.column.id === mobileTitleColumnId) ?? cells[0];
            const content = (
              <>
                <p className="font-medium text-ink">
                  <table.FlexRender cell={titleCell} />
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {cells
                    .filter((cell) => cell !== titleCell)
                    .map((cell) => (
                      <Fragment key={cell.id}>
                        <dt className="text-muted">{columnLabel(cell.column.columnDef.header, cell.column.id)}</dt>
                        <dd className="min-w-0 break-words text-right text-ink">
                          <table.FlexRender cell={cell} />
                        </dd>
                      </Fragment>
                    ))}
                </dl>
              </>
            );
            return (
              <li key={row.id}>
                {onRowClick ? (
                  <button
                    type="button"
                    onClick={() => onRowClick(row.original)}
                    className="w-full rounded-md border border-border bg-surface p-4 text-left hover:bg-canvas focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="rounded-md border border-border bg-surface p-4">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className={cn(
                    "px-4 py-3 text-left font-medium text-muted",
                    header.column.getCanSort() && "cursor-pointer select-none",
                  )}
                >
                  {header.isPlaceholder ? null : (
                    <span className="inline-flex items-center gap-1">
                      <table.FlexRender header={header} />
                      {header.column.getIsSorted() === "asc" && <ChevronUp className="h-3.5 w-3.5" />}
                      {header.column.getIsSorted() === "desc" && <ChevronDown className="h-3.5 w-3.5" />}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={table.getAllLeafColumns().length} className="px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-canvas")}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 text-ink">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
