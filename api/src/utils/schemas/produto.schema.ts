import { z } from "zod";
import categoriasNomesEnum, {
    CategoriasNomesEnum,
} from "../../enums/categorias_nomes.enum";

const categoriasNomes = categoriasNomesEnum.options.join(", ");

const isCategoriaNome = (value: string) =>
    categoriasNomesEnum.options.includes(value as CategoriasNomesEnum);
const categoriaNomeMessage = `As categorias devem ser dos tipos ${categoriasNomes}`;

const ProdutoSchema = z.object({
    id: z.string().uuid().nonempty("É necessário prover um ID"),
    name: z.string().nonempty("É necessário prover um nome para o produto"),
    ativo: z.boolean().default(true),
    sku: z.string().nonempty("É necessário prover um SKU para o produto"),
    categoria: z
        .string()
        .refine(isCategoriaNome, { message: categoriaNomeMessage }),
    valor_de_custo: z.number().nonnegative("O valor precisa ser positivo"),
    icms: z
        .number()
        .int()
        .nonnegative("A taxa de ICMS precisa ser positivo")
        .default(0),
    valor_de_venda: z
        .number()
        .nonnegative("O valor de venda precisa ser positivo")
        .default(0),
    data_de_cadastro: z.date().default(new Date()),
    quantidade_em_estoque: z
        .number()
        .int()
        .nonnegative("É necessário que a quantidade em estoque seja positiva."),
});

// POST /products: no id (generated), no ativo (always true) and no data_de_cadastro (set by the server)
export const CreateProdutoSchema = z.object({
    name: z.string().trim().nonempty("É necessário prover um nome para o produto"),
    sku: z.string().trim().nonempty("É necessário prover um SKU para o produto"),
    categoria: z.object(
        {
            nome: z.string().refine(isCategoriaNome, {
                message: categoriaNomeMessage,
            }),
        },
        { required_error: "É necessário prover uma categoria" }
    ),
    valor_de_custo: z.number().nonnegative("O valor precisa ser positivo"),
    // ICMS rates can be fractional (e.g. 17.5%)
    icms: z
        .number()
        .nonnegative("A taxa de ICMS precisa ser positivo")
        .default(0),
    valor_de_venda: z
        .number()
        .nonnegative("O valor de venda precisa ser positivo")
        .default(0),
    quantidade_em_estoque: z
        .number()
        .int("A quantidade em estoque precisa ser um número inteiro")
        .nonnegative("É necessário que a quantidade em estoque seja positiva."),
});

export default ProdutoSchema;