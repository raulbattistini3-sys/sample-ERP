import { ALL_ITEMS_AMOUNT } from "../../../lib/pagination";
import { csvNumber, toCsv } from "../../../lib/csv";
import { getProductsDownloadPage } from "../api/product.api";
import { Product } from "../types/produto.types";

// GET /products/download pages the products; the per-categoria totals always cover all of them
export async function fetchProductsForDownload() {
  const products: Product[] = [];
  let totals: Record<string, number> = {};
  for (let page = 1; ; page++) {
    const result = await getProductsDownloadPage(page, ALL_ITEMS_AMOUNT);
    products.push(...result.data);
    totals = result.aggregated_value;
    if (result.data.length === 0 || products.length >= result.totalItems) break;
  }
  return { products, totals };
}

export function productsToCsv(products: Product[], totals: Record<string, number>) {
  const header = [
    "SKU",
    "Nome",
    "Categoria",
    "Valor de custo (R$)",
    "ICMS (%)",
    "Valor de venda (R$)",
    "Estoque",
    "Status",
    "Data de cadastro",
  ];
  const rows = products.map((p) => [
    p.sku,
    p.name,
    p.categoria.nome,
    csvNumber(p.valor_de_custo),
    csvNumber(p.icms),
    csvNumber(p.valor_de_venda),
    p.quantidade_em_estoque,
    p.ativo ? "Ativo" : "Inativo",
    new Date(p.data_de_cadastro).toLocaleDateString("pt-BR"),
  ]);
  const totalRows = Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([categoria, total]) => [categoria, csvNumber(total)]);

  return toCsv([
    header,
    ...rows,
    [],
    ["Total de venda por categoria", "Valor de venda (R$)"],
    ...totalRows,
  ]);
}

// produtos-2026-10-20.csv (local date)
export const productsFileName = () => `produtos-${new Date().toLocaleDateString("sv-SE")}.csv`;
