import { z } from "zod";
import acaoEfetuadaEnum from "../../enums/acao_efetuada.enum";

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
