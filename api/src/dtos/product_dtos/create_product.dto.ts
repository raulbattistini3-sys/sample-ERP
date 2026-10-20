import { Categoria } from "../../entities/categoria.entity";
import { ProductResponseDto } from "./product_response.dto";

// the API speaks snake_case; product.mapper.ts converts to/from the camelCase table columns
type CreateProductDto = {
    name: string;
    sku: string;
    categoria: Pick<Categoria, "nome">;
    valor_de_custo: number;
    icms?: number;
    valor_de_venda?: number;
    quantidade_em_estoque: number;
};

type ResponseCreateProductDto = ProductResponseDto;

export { CreateProductDto, ResponseCreateProductDto };
