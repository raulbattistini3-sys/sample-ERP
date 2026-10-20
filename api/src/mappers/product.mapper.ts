import { CreateProductDto } from "../dtos/product_dtos/create_product.dto";
import { PayloadUpdateProductDto } from "../dtos/product_dtos/update_product.dto";
import { ProductResponseDto } from "../dtos/product_dtos/product_response.dto";
import { Categoria } from "../entities/categoria.entity";
import { NewProductEntity, ProductEntity, ProductWithCategoria } from "../entities/product.entity";

// pg returns numeric/decimal columns as strings even with mode: "number"
const toNumber = (value: number | string) => Number(value);

export const toNewProductEntity = (
   dto: CreateProductDto,
   categoriaId: string,
   dataDeCadastro: Date,
): NewProductEntity => ({
   name: dto.name,
   sku: dto.sku,
   ativo: true,
   categoriaId,
   valorDeCusto: dto.valor_de_custo,
   icms: dto.icms ?? 0,
   valorDeVenda: dto.valor_de_venda ?? 0,
   dataDeCadastro,
   quantidadeEmEstoque: dto.quantidade_em_estoque,
});

// only the editable columns; id and data_de_cadastro never change
export const toProductUpdateEntity = (
   dto: PayloadUpdateProductDto,
   categoriaId: string,
): Partial<NewProductEntity> => ({
   name: dto.name,
   sku: dto.sku,
   categoriaId,
   valorDeCusto: dto.valor_de_custo,
   icms: dto.icms ?? 0,
   valorDeVenda: dto.valor_de_venda ?? 0,
   quantidadeEmEstoque: dto.quantidade_em_estoque,
   ...(dto.ativo !== undefined && { ativo: dto.ativo }),
});

export const toProductResponse = (
   product: ProductEntity,
   categoria: Categoria,
): ProductResponseDto => ({
   id: product.id,
   name: product.name,
   ativo: product.ativo,
   sku: product.sku,
   categoria: { id: categoria.id, nome: categoria.nome, tipo: categoria.tipo },
   valor_de_custo: toNumber(product.valorDeCusto),
   icms: toNumber(product.icms),
   valor_de_venda: toNumber(product.valorDeVenda),
   data_de_cadastro: product.dataDeCadastro,
   quantidade_em_estoque: toNumber(product.quantidadeEmEstoque),
});

export const toProductResponseFromRow = ({ produto, categoria }: ProductWithCategoria) =>
   toProductResponse(produto, categoria);
