import { createColumnHelper } from "@tanstack/react-table";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { StatusBadge } from "../../../components/ui/PageState";
import { Categoria } from "../types/categoria.types";

const helper = createColumnHelper<DataTableFeatures, Categoria>();

const categoriaColumns = helper.columns([
  helper.accessor("nome", { header: "Nome" }),
  helper.accessor("tipo", { header: "Tipo" }),
  helper.accessor("ativo", {
    header: "Status",
    cell: ({ getValue }) => <StatusBadge active={getValue()} />,
  }),
]);

type CategoriaTableProps = {
  categorias?: Categoria[];
  onRowClick?: (categoria: Categoria) => void;
};

export function CategoriaTable({ categorias, onRowClick }: CategoriaTableProps) {
  return <DataTable columns={categoriaColumns} data={categorias} onRowClick={onRowClick} />;
}
