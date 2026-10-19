import { createColumnHelper } from "@tanstack/react-table";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { Categoria } from "../types/categoria.types";

const helper = createColumnHelper<DataTableFeatures, Categoria>();

const categoriaColumns = helper.columns([
  helper.accessor("nome", { header: "Nome" }),
  helper.accessor("tipo", { header: "Tipo" }),
  helper.accessor("ativo", {
    header: "Status",
    cell: ({ getValue }) => (getValue() ? "Ativo" : "Inativo"),
  }),
]);

export function CategoriaTable({ categorias }: { categorias?: Categoria[] }) {
  return <DataTable columns={categoriaColumns} data={categorias} />;
}
