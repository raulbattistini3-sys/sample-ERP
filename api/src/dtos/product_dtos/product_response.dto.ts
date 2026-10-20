import { Categoria } from "../../entities/categoria.entity";

// how every product endpoint returns a product: snake_case, with its category inlined
type ProductResponseDto = {
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

export { ProductResponseDto };
