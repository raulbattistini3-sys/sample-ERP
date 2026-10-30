import { z } from "zod";
import categoriasNomesEnum, {
    CategoriasNomesEnum,
} from "../../enums/categorias_nomes.enum";

const categoriasNomes = categoriasNomesEnum.options.join(", ");

const isCategoriaNome = (value: string) =>
    categoriasNomesEnum.options.includes(value as CategoriasNomesEnum);
const categoriaNomeMessage = `As categorias devem ser dos tipos ${categoriasNomes}`;

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

// POST /products/import: the envelope; each row is then checked on its own against
// CreateProdutoSchema, so every row's problems can be reported at once
export const MAX_IMPORT_ROWS = 500000;
export const ImportProdutosSchema = z.object({
    rows: z
        .array(z.object({ linha: z.number().int().positive() }).passthrough(), {
            required_error: "Envie as linhas da planilha.",
        })
        .min(1, "A planilha não tem nenhum produto.")
        .max(MAX_IMPORT_ROWS, `Importe no máximo ${MAX_IMPORT_ROWS} produtos por vez.`),
});

// PUT /products/:id: same rules as create plus the id (taken from the URL);
// data_de_cadastro is never changed, so it's ignored if sent
export const UpdateProdutoSchema = CreateProdutoSchema.extend({
    id: z.string().uuid("É necessário prover um ID válido"),
    ativo: z.boolean().optional(),
});

// query strings, so numbers are coerced
const numberParam = (label: string) =>
    z.coerce
        .number({ invalid_type_error: `${label} precisa ser um número` })
        .nonnegative(`${label} precisa ser positivo`);

// GET /products/filter and /products/download: every filter is optional and they combine with AND
export const FilterProdutoSchema = z.object({
    name: z.string().trim().optional(), // case-insensitive "contains"
    sku: z.string().trim().optional(),
    categoria: z
        .string()
        .refine(isCategoriaNome, { message: categoriaNomeMessage })
        .optional(),
    valor_de_custo: numberParam("O valor de custo").optional(),
    icms: numberParam("O ICMS").optional(),
    valor_de_venda: numberParam("O valor de venda").optional(),
    data_de_cadastro: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "A data de cadastro deve estar no formato AAAA-MM-DD")
        .optional(),
});