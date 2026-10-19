import { createColumnHelper } from "@tanstack/react-table";
import type { DataTableFeatures } from "../../../components/ui/DataTable";
import { Product } from "../types/produto.types";

const helper = createColumnHelper<DataTableFeatures, Product>();

export const productColumns = helper.columns([
  helper.accessor("sku", { header: "SKU" }),
  helper.accessor("name", { header: "Nome" }),
  helper.accessor("categoria.nome", { header: "Categoria" }),
  helper.accessor("valor_de_venda", {
    header: "Preço",
    cell: ({ getValue }) => `R$ ${getValue().toFixed(2)}`,
  }),
  helper.accessor("quantidade_em_estoque", { header: "Estoque" }),
  helper.accessor("ativo", {
    header: "Status",
    cell: ({ getValue }) => (
      <span className={getValue() ? "text-accent" : "text-muted"}>
        {getValue() ? "Ativo" : "Inativo"}
      </span>
    ),
  }),
]);
