// decimals stay strings ("12.50"), as the column has no mode:"number"
type DetalhamentoAuditoriaResponseDto = {
    id: string;
    nome_do_produto: string;
    valor_anterior: string;
    valor_atual: string;
    observacoes_adicionais: string;
};

export { DetalhamentoAuditoriaResponseDto };
