import { createColumnHelper } from "@tanstack/react-table";
import { Bookmark, Star } from "lucide-react";
import type { Marcacoes } from "../api/product.api";
import type { DataTableFeatures } from "../../../components/ui/DataTable";
import { StatusBadge } from "../../../components/ui/PageState";
import { formatCurrency, formatDate } from "../../../lib/form";
import { Product } from "../types/produto.types";

const helper = createColumnHelper<DataTableFeatures, Product>();

// the user's own marks next to the name: ★ favourite, 🔖 saved for later
export const productColumnsComMarcacoes = (marcacoes: Marcacoes | undefined) => {
  const favoritos = new Set(marcacoes?.favorito);
  const depois = new Set(marcacoes?.depois);
  return helper.columns([
    helper.accessor("sku", { header: "SKU" }),
    helper.accessor("name", {
      header: "Nome",
      cell: ({ getValue, row }) => (
        <span className="inline-flex items-center gap-1.5">
          {getValue()}
          {favoritos.has(row.original.id) && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label="Favorito" />}
          {depois.has(row.original.id) && <Bookmark className="h-3.5 w-3.5 shrink-0 fill-accent/30 text-accent" aria-label="Salvo para depois" />}
        </span>
      ),
    }),
    ...productColumns.slice(2),
  ]);
};

export const productColumns = helper.columns([
  helper.accessor("sku", { header: "SKU" }),
  helper.accessor("name", { header: "Nome" }),
  helper.accessor("categoria.nome", { header: "Categoria" }),
  helper.accessor("valor_de_venda", {
    header: "Preço",
    cell: ({ getValue }) => formatCurrency(getValue()),
  }),
  helper.accessor("quantidade_em_estoque", { header: "Estoque" }),
  helper.accessor("data_de_cadastro", {
    header: "Cadastro",
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.accessor("ativo", {
    header: "Status",
    cell: ({ getValue }) => <StatusBadge active={getValue()} />,
  }),
]);
