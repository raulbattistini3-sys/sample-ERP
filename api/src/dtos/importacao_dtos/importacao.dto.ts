// A spreadsheet import run by the Go importer (importer/, proto/importador/v1) or the API's own
// (queues/importacoes.worker.ts), as the API returns it.
// pendente/processando are still running; the other three are final.
type StatusImportacaoDto = "pendente" | "processando" | "concluida" | "rejeitada" | "falhou";

// one problem in one spreadsheet line (the line number the user sees in Excel); campo is the column
// (sku, name, categoria, valor_de_custo, ...) or empty when the problem is the whole line, and always
// empty from the API's own importer
type ErroLinhaImportacaoDto = { linha: number; campo: string; mensagem: string };

type ImportacaoDto = {
   id: string;
   status: StatusImportacaoDto;
   nome_arquivo: string;
   total_linhas: number;
   // linhas_criadas + linhas_atualizadas; 0 unless concluida
   linhas_importadas: number;
   linhas_criadas: number;
   linhas_atualizadas: number;
   // rejeitada: every invalid line's problems (nothing was saved)
   erros: ErroLinhaImportacaoDto[];
   // falhou (the file couldn't be read), or rejeitada for a reason that isn't one line's
   mensagem: string;
   criada_em: string | null;
   finalizada_em: string | null;
};

type IniciarImportacaoDto = { planilha: Buffer; nomeArquivo: string; usuarioId: string };

export { StatusImportacaoDto, ErroLinhaImportacaoDto, ImportacaoDto, IniciarImportacaoDto };
