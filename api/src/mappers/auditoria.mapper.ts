import { AuditoriaResponseDto } from "../dtos/auditoria_dtos/auditoria_response.dto";
import { DetalhamentoAuditoriaResponseDto } from "../dtos/detalhamento_auditoria/detalhamento_auditoria_response.dto";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import { DetalhamentoAuditoriaEntity } from "../entities/detalhamento_auditoria.entity";

export const toAuditoriaResponse = (auditoria: AuditoriaEntity): AuditoriaResponseDto => ({
   id: auditoria.id,
   acao_efetuada: auditoria.acaoEfetuada,
   data_de_audicao: auditoria.dataDeAudicao,
   nome_do_auditor: auditoria.nomeDoAuditorId,
   detalhamento_auditoria_id: auditoria.detalhamentoAuditoriaId,
});

export const toDetalhamentoAuditoriaResponse = (
   detalhamento: DetalhamentoAuditoriaEntity,
): DetalhamentoAuditoriaResponseDto => ({
   id: detalhamento.id,
   nome_do_produto: detalhamento.nomeDoProduto,
   valor_anterior: detalhamento.valorAnterior,
   valor_atual: detalhamento.valorAtual,
   observacoes_adicionais: detalhamento.observacoesAdicionais,
});
