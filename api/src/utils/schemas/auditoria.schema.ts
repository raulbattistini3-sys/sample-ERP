import { z } from "zod";
import acaoEfetuadaEnum from "../../enums/acao_efetuada.enum";
import { CreateProdutoSchema } from "./produto.schema";
import { CreateCategoriaSchema } from "./categoria.schema";

const acaoEfetuadaMessage = `A ação efetuada deve ser uma de: ${acaoEfetuadaEnum.options.join(", ")}`;

// decimals may arrive as numbers or as numeric strings ("12.50")
const valor = (label: string) =>
    z.coerce
        .number({ invalid_type_error: `${label} precisa ser um número` })
        .nonnegative(`${label} precisa ser positivo`);

// POST /auditoria: creates the detalhamento, the auditoria and its produtos in one go
export const CreateAuditoriaSchema = z.object({
    acao_efetuada: z.enum(acaoEfetuadaEnum.options, {
        errorMap: () => ({ message: acaoEfetuadaMessage }),
    }),
    // ISO string over the wire
    data_de_audicao: z.coerce.date({
        errorMap: () => ({ message: "Informe uma data de auditoria válida" }),
    }),
    // the auditor; their name comes from the usuarios endpoint, it isn't stored here
    usuario_id: z
        .string({ required_error: "É necessário prover o usuário auditor." })
        .uuid("Usuário auditor inválido"),
    itens: z
        .array(z.string().uuid("Produto inválido"), {
            required_error: "É necessário haver um produto para se fazer a auditoria.",
        })
        .nonempty("É necessário haver um produto para se fazer a auditoria."),
    detalhamento_auditoria: z.object(
        {
            nome_do_produto: z
                .string()
                .trim()
                .nonempty("É necessário prover o nome do produto da auditoria"),
            valor_anterior: valor("O valor anterior"),
            valor_atual: valor("O valor atual"),
            observacoes_adicionais: z.string().trim().default(""),
        },
        { required_error: "É necessário prover o detalhamento da auditoria" },
    ),
});

// PUT /auditoria/:id
export const UpdateAuditoriaSchema = CreateAuditoriaSchema.extend({
    id: z.string().uuid("É necessário prover um ID válido para a auditoria."),
});

// POST /auditoria/manual: the auditoria applies its own changes to one product or categoria. `valores`
// is the full record as it should end up (same fields as the product/categoria PUT); the server diffs
// it against the stored row, saves both and records every changed field, in one transaction.
const AlvoProdutoSchema = z.object({
    tipo: z.literal("produto"),
    id: z.string().uuid("Produto inválido"),
    valores: CreateProdutoSchema.extend({
        ativo: z.boolean({ required_error: "Informe o status do produto" }),
    }),
});

const AlvoCategoriaSchema = z.object({
    tipo: z.literal("categoria"),
    id: z.string().uuid("Categoria inválida"),
    valores: CreateCategoriaSchema.extend({
        ativo: z.boolean({ required_error: "Informe o status da categoria" }),
    }),
});

export const CreateAuditoriaManualSchema = CreateAuditoriaSchema.pick({
    acao_efetuada: true,
    data_de_audicao: true,
    usuario_id: true,
}).extend({
    observacoes_adicionais: z
        .string()
        .trim()
        .max(1000, "As observações podem ter no máximo 1000 caracteres")
        .default(""),
    alvo: z.discriminatedUnion("tipo", [AlvoProdutoSchema, AlvoCategoriaSchema], {
        errorMap: () => ({ message: "Escolha um produto ou uma categoria para auditar" }),
    }),
});
