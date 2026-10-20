import { AuditoriaResponseDto } from "../dtos/auditoria_dtos/auditoria_response.dto";
import { CreateAuditoriaDto, NewAuditoriaWithItens } from "../dtos/auditoria_dtos/create_auditoria.dto";
import { DetalhamentoAuditoriaResponseDto } from "../dtos/detalhamento_auditoria/detalhamento_auditoria_response.dto";
import { AuditoriaEntity } from "../entities/auditoria.entity";
import { DetalhamentoAuditoriaEntity } from "../entities/detalhamento_auditoria.entity";

export const toAuditoriaResponse = (auditoria: AuditoriaEntity): AuditoriaResponseDto => ({
   id: auditoria.id,
   acao_efetuada: auditoria.acaoEfetuada,
   data_de_audicao: auditoria.dataDeAudicao,
   usuario_id: auditoria.usuarioId,
   detalhamento_auditoria_id: auditoria.detalhamentoAuditoriaId,
});

// decimal columns without mode:"number" take strings
export const toNewAuditoriaWithItens = (dto: CreateAuditoriaDto): NewAuditoriaWithItens => ({
   auditoria: {
      acaoEfetuada: dto.acao_efetuada,
      dataDeAudicao: dto.data_de_audicao,
      usuarioId: dto.usuario_id,
   },
   detalhamento: {
      nomeDoProduto: dto.detalhamento_auditoria.nome_do_produto,
      valorAnterior: dto.detalhamento_auditoria.valor_anterior.toFixed(2),
      valorAtual: dto.detalhamento_auditoria.valor_atual.toFixed(2),
      observacoesAdicionais: dto.detalhamento_auditoria.observacoes_adicionais,
   },
   // the same product listed twice would break the produtos_por_auditoria primary key
   produtoIds: [...new Set(dto.itens)],
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
