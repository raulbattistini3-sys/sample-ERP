import { ChangeEvent, useEffect, useState } from "react";
import axios from "axios";
import { createColumnHelper } from "@tanstack/react-table";
import { ArrowLeft, FileDown, Loader2, Upload } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { ErrorAlert, FormCard, PageHeader, SuccessAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { useBackToList } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { downloadTextFile } from "../../../lib/csv";
import { formatCurrency } from "../../../lib/form";
import { isAdminRole } from "../../../lib/permissoes";
import { readSpreadsheetRows, SPREADSHEET_ACCEPT } from "../../../lib/spreadsheet";
import { useImportProducts, useProductImport, useStartProductImport } from "../hooks/useProducts";
import { isProductImportFinished, ProductImport } from "../api/product.api";
import { IMPORT_COLUMNS, ImportRow, ImportRowError, importTemplateCsv, rowsToImport } from "../utils/productsImport";

const PREVIEW_ROWS = 20;
// past this, a queued import gets a hint that the importer may be busy or down
const SLOW_IMPORT_MS = 30_000;

// How an import ended, whichever way it ran: through the importer (the file is uploaded and the result
// polled) or, when the Go importer doesn't answer (503), through POST /products/import with the rows read here.
type Outcome =
  | { kind: "concluida"; criados: number; atualizados: number }
  | { kind: "rejeitada"; erros: ImportRowError[]; mensagem?: string }
  | { kind: "falhou"; mensagem: string };

const importerUnavailable = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 503;

// the importer reports one error per field; listed per line, like the in-API import's
const errorsByLine = (erros: ProductImport["erros"]): ImportRowError[] => {
  const byLine = new Map<number, string[]>();
  for (const { linha, mensagem } of erros) byLine.set(linha, [...(byLine.get(linha) ?? []), mensagem]);
  return [...byLine.entries()].sort(([a], [b]) => a - b).map(([linha, mensagens]) => ({ linha, mensagens }));
};

const importerOutcome = (importacao: ProductImport | undefined): Outcome | null => {
  if (!importacao || !isProductImportFinished(importacao.status)) return null;
  switch (importacao.status) {
    case "concluida":
      return { kind: "concluida", criados: importacao.linhas_criadas, atualizados: importacao.linhas_atualizadas };
    case "rejeitada":
      return { kind: "rejeitada", erros: errorsByLine(importacao.erros), mensagem: importacao.mensagem || undefined };
    default:
      return { kind: "falhou", mensagem: importacao.mensagem || "Não foi possível ler a planilha." };
  }
};

const helper = createColumnHelper<DataTableFeatures, ImportRow>();
const previewColumns = helper.columns([
  helper.accessor("linha", { header: "Linha" }),
  helper.accessor("sku", { header: "SKU" }),
  helper.accessor("name", { header: "Nome" }),
  helper.accessor("categoria.nome", { header: "Categoria" }),
  helper.accessor("valor_de_venda", { header: "Venda", cell: ({ getValue }) => formatCurrency(getValue() ?? 0) }),
  helper.accessor("quantidade_em_estoque", { header: "Estoque" }),
]);

function RowErrors({ errors }: { errors: ImportRowError[] }) {
  return (
    <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm text-red-700">
      {errors.map(({ linha, mensagens }) => (
        <li key={linha}>
          <span className="font-medium">Linha {linha}:</span> {mensagens.join("; ")}
        </li>
      ))}
    </ul>
  );
}

export const ProductImportPage = () => {
  const { user } = useAuth();
  const backToList = useBackToList("/products");
  const startImport = useStartProductImport();
  const fallbackImport = useImportProducts();

  const [file, setFile] = useState<File | null>(null);
  const [readError, setReadError] = useState("");
  const [parsed, setParsed] = useState<{ items: ImportRow[]; errors: ImportRowError[] } | null>(null);
  const [importId, setImportId] = useState<string>();
  const [slow, setSlow] = useState(false);

  const importacao = useProductImport(importId);

  const fallback = fallbackImport.data;
  const outcome: Outcome | null = fallback
    ? fallback.errors.length > 0
      ? { kind: "rejeitada", erros: fallback.errors }
      : { kind: "concluida", criados: fallback.created, atualizados: fallback.updated }
    : importerOutcome(importacao.data);
  // a 503 from startImport isn't shown: the fallback import takes over
  const requestError =
    (startImport.isError && !importerUnavailable(startImport.error) && startImport.error) ||
    (fallbackImport.isError && fallbackImport.error) ||
    (importacao.isError && importacao.error) ||
    null;
  const pending = startImport.isPending || fallbackImport.isPending || (!!importId && !outcome && !importacao.isError);
  const queued = !!importId && pending;

  useEffect(() => {
    setSlow(false);
    if (!queued) return;
    const timer = setTimeout(() => setSlow(true), SLOW_IMPORT_MS);
    return () => clearTimeout(timer);
  }, [queued, importId]);

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem importar produtos." />;
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // picking the same file again still triggers a change
    if (!chosen) return;
    startImport.reset();
    fallbackImport.reset();
    setImportId(undefined);
    setFile(chosen);
    setReadError("");
    setParsed(null);
    try {
      // read here too, for the preview and the instant checks; the importer reads the file again and decides
      setParsed(rowsToImport(await readSpreadsheetRows(chosen)));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    }
  };

  const handleImport = () => {
    if (!file || !parsed) return;
    fallbackImport.reset();
    setImportId(undefined);
    startImport.mutate(file, {
      onSuccess: (started) => setImportId(started.id),
      onError: (error) => {
        if (importerUnavailable(error)) fallbackImport.mutate(parsed.items);
      },
    });
  };

  const imported = outcome?.kind === "concluida";
  const canImport = !!parsed && parsed.items.length > 0 && parsed.errors.length === 0 && !imported && !pending;

  return (
    <div>
      <PageHeader
        title="Importar produtos"
        actions={
          <Button variant="ghost" onClick={backToList}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar
          </Button>
        }
      />

      <div className="space-y-4">
        <FormCard>
          <h3 className="text-sm font-semibold text-ink">Como montar a planilha</h3>
          <p className="mt-1 text-sm text-muted">
            Arquivo <strong>.xlsx</strong> ou <strong>.csv</strong> (separado por ponto e vírgula ou vírgula). As colunas
            são lidas pela posição, nesta ordem:
          </p>
          <ol className="mt-2 grid list-decimal gap-x-6 gap-y-0.5 pl-5 text-sm text-ink sm:grid-cols-2">
            {IMPORT_COLUMNS.map((column) => (
              <li key={column}>{column}</li>
            ))}
          </ol>
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-muted">
            <li>A primeira linha pode ser o cabeçalho; colunas depois de Estoque são ignoradas.</li>
            <li>ICMS e Valor de venda podem ficar vazios (viram 0). Estoque é um número inteiro.</li>
            <li>Se o SKU já existir, o produto é atualizado (e reativado); senão, é criado.</li>
            <li>A planilha baixada em Produtos já está nesse formato: edite e importe de volta.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-within:ring-2 focus-within:ring-accent/40">
              <Upload className="h-4 w-4" aria-hidden="true" />
              Escolher arquivo
              <input type="file" accept={SPREADSHEET_ACCEPT} onChange={handleFile} className="sr-only" />
            </label>
            <Button variant="secondary" onClick={() => downloadTextFile("modelo-importacao-produtos.csv", importTemplateCsv())}>
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Baixar modelo
            </Button>
          </div>
          {file && <p className="mt-2 text-sm text-muted">Arquivo: {file.name}</p>}
        </FormCard>

        {readError && <ErrorAlert message={readError} />}

        {parsed && (
          <FormCard className="max-w-none">
            <p className="text-sm text-ink">
              {parsed.items.length} produto(s) prontos para importar
              {parsed.errors.length > 0 && `, ${parsed.errors.length} linha(s) com erro`}.
            </p>

            {parsed.errors.length > 0 && (
              <div className="mt-3">
                <ErrorAlert message="Corrija estas linhas na planilha e escolha o arquivo de novo:" />
                <RowErrors errors={parsed.errors} />
              </div>
            )}

            {parsed.items.length > 0 && (
              <div className="mt-4">
                <DataTable columns={previewColumns} data={parsed.items.slice(0, PREVIEW_ROWS)} mobileTitleColumnId="name" />
                {parsed.items.length > PREVIEW_ROWS && (
                  <p className="mt-2 text-xs text-muted">
                    Mostrando {PREVIEW_ROWS} de {parsed.items.length}.
                  </p>
                )}
              </div>
            )}

            {queued && (
              <div className="mt-4 text-sm text-muted" role="status">
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {importacao.data?.status === "processando" ? "Importando no servidor..." : "Na fila do importador..."}
                </p>
                {slow && (
                  <p className="mt-1">
                    Está demorando mais que o normal: o importador pode estar ocupado ou fora do ar. Você pode sair
                    desta página; a importação continua e os produtos aparecem na lista quando ela terminar.
                  </p>
                )}
              </div>
            )}
            {requestError && (
              <ErrorAlert message={getApiErrorMessage(requestError, "Não foi possível importar a planilha.")} className="mt-4" />
            )}
            {outcome?.kind === "rejeitada" && (
              <div className="mt-4">
                <ErrorAlert message={outcome.mensagem ?? "Nada foi salvo. O servidor recusou estas linhas:"} />
                {outcome.erros.length > 0 && <RowErrors errors={outcome.erros} />}
              </div>
            )}
            {outcome?.kind === "falhou" && <ErrorAlert message={outcome.mensagem} className="mt-4" />}
            {outcome?.kind === "concluida" && (
              <SuccessAlert
                className="mt-4"
                message={`Importação concluída: ${outcome.criados} produto(s) criado(s), ${outcome.atualizados} atualizado(s).`}
              />
            )}

            <div className="mt-4 flex justify-end gap-2">
              {imported ? (
                <Button onClick={backToList}>Ver produtos</Button>
              ) : (
                <Button onClick={handleImport} disabled={!canImport}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Importar {parsed.items.length} produto(s)
                </Button>
              )}
            </div>
          </FormCard>
        )}
      </div>
    </div>
  );
};
