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
import { Fragment, useEffect, useRef, useState } from "react";
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

// Row checkboxes for bulk actions: the page keeps the ids (so a selection survives sorting, filtering
// and loading more), the table only shows and toggles them. The header box covers the rows on screen.
export type DataTableSelection<TData> = {
  selectedIds: ReadonlySet<string>;
  getRowId: (row: TData) => string;
  onChange: (ids: Set<string>) => void;
  rowLabel?: (row: TData) => string;
};

function Checkbox({ checked, indeterminate = false, label, onChange }: { checked: boolean; indeterminate?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      // a click on the box must not open the row
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
    />
  );
}

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[];
  data?: TData[];
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  // on mobile each row becomes a card; this column is its title (defaults to the first column)
  mobileTitleColumnId?: string;
  selection?: DataTableSelection<TData>;
};

// plain-text label for a column on the mobile cards and the sort select
const columnLabel = (header: unknown, fallback: string) => (typeof header === "string" ? header : fallback);

export function DataTable<TData extends RowData>({
  columns,
  data = EMPTY_DATA,
  onRowClick,
  emptyMessage = "Nenhum registro encontrado.",
  mobileTitleColumnId,
  selection,
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

  const visibleIds = selection ? rows.map((row) => selection.getRowId(row.original)) : [];
  const selectedVisible = selection ? visibleIds.filter((id) => selection.selectedIds.has(id)).length : 0;
  const allVisibleSelected = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  const toggleRow = (row: TData) => {
    if (!selection) return;
    const id = selection.getRowId(row);
    const next = new Set(selection.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const toggleVisible = () => {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    visibleIds.forEach((id) => (allVisibleSelected ? next.delete(id) : next.add(id)));
    selection.onChange(next);
  };
  const rowCheckbox = (row: TData) =>
    selection && (
      <Checkbox
        checked={selection.selectedIds.has(selection.getRowId(row))}
        label={`Selecionar ${selection.rowLabel?.(row) ?? "linha"}`}
        onChange={() => toggleRow(row)}
      />
    );
  const headerCheckbox = selection && (
    <Checkbox
      checked={allVisibleSelected}
      indeterminate={selectedVisible > 0 && !allVisibleSelected}
      label={allVisibleSelected ? "Desmarcar os itens da lista" : "Selecionar todos os itens da lista"}
      onChange={toggleVisible}
    />
  );

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

        {selection && rows.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            {headerCheckbox}
            Selecionar todos ({rows.length})
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
              <li key={row.id} className={cn(selection && "flex items-start gap-3")}>
                {selection && <span className="pt-4 pl-1">{rowCheckbox(row.original)}</span>}
                <div className={cn(selection && "min-w-0 flex-1")}>
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
                </div>
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
              {selection && <th className="w-10 px-4 py-3">{headerCheckbox}</th>}
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
              <td colSpan={table.getAllLeafColumns().length + (selection ? 1 : 0)} className="px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className={cn(
                "border-b border-border last:border-0",
                onRowClick && "cursor-pointer hover:bg-canvas",
                selection?.selectedIds.has(selection.getRowId(row.original)) && "bg-accent-soft/40",
              )}
            >
              {selection && (
                <td className="w-10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  {rowCheckbox(row.original)}
                </td>
              )}
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
