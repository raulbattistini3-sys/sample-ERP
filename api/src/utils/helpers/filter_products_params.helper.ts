import { ProductFilterDto } from "../../dtos/product_dtos/get_products.dto";
import { ProductWithCategoria } from "../../entities/product.entity";

// keeps the rows matching every filter that was given; filters left out match everything
export default function filterProducts(
   rows: ProductWithCategoria[],
   filters: ProductFilterDto,
): ProductWithCategoria[] {
   const name = filters.name?.toLowerCase();
   const matches = <T>(filter: T | undefined, value: T) =>
      filter === undefined || filter === value;

   return rows.filter(
      ({ produto, categoria }) =>
         (!name || produto.name.toLowerCase().includes(name)) &&
         matches(filters.sku, produto.sku) &&
         matches(filters.categoria, categoria.nome) &&
         matches(filters.valor_de_custo, Number(produto.valorDeCusto)) &&
         matches(filters.icms, Number(produto.icms)) &&
         matches(filters.valor_de_venda, Number(produto.valorDeVenda)) &&
         // compared as a UTC calendar day (YYYY-MM-DD)
         matches(
            filters.data_de_cadastro,
            produto.dataDeCadastro.toISOString().slice(0, 10),
         ),
   );
}
