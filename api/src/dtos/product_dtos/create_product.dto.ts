import { Categoria } from "../../entities/categoria.entity";

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

type ResponseCreateProductDto = {
    id: string;
    name: string;
    ativo: boolean;
    sku: string;
    categoria: Pick<Categoria, "nome" | "tipo" | "id">;
    valor_de_custo: number;
    icms: number;
    valor_de_venda: number;
    data_de_cadastro: Date;
    quantidade_em_estoque: number;
};

export { CreateProductDto, ResponseCreateProductDto };
