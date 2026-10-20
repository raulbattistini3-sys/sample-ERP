import { ChangeEvent, useState } from "react";
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
import { useImportProducts } from "../hooks/useProducts";
import { IMPORT_COLUMNS, ImportRow, ImportRowError, importTemplateCsv, rowsToImport } from "../utils/productsImport";

const PREVIEW_ROWS = 20;

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
  const importMutation = useImportProducts();

  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState("");
  const [parsed, setParsed] = useState<{ items: ImportRow[]; errors: ImportRowError[] } | null>(null);

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem importar produtos." />;
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // picking the same file again still triggers a change
    if (!file) return;
    importMutation.reset();
    setFileName(file.name);
    setReadError("");
    setParsed(null);
    try {
      setParsed(rowsToImport(await readSpreadsheetRows(file)));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    }
  };

  const result = importMutation.data;
  const serverErrors = result?.errors ?? [];
  const imported = result && serverErrors.length === 0;
  const canImport = !!parsed && parsed.items.length > 0 && parsed.errors.length === 0 && !imported;

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
          {fileName && <p className="mt-2 text-sm text-muted">Arquivo: {fileName}</p>}
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

            {importMutation.isError && (
              <ErrorAlert
                message={getApiErrorMessage(importMutation.error, "Não foi possível importar a planilha.")}
                className="mt-4"
              />
            )}
            {serverErrors.length > 0 && (
              <div className="mt-4">
                <ErrorAlert message="Nada foi salvo. O servidor recusou estas linhas:" />
                <RowErrors errors={serverErrors} />
              </div>
            )}
            {imported && (
              <SuccessAlert
                className="mt-4"
                message={`Importação concluída: ${result.created} produto(s) criado(s), ${result.updated} atualizado(s).`}
              />
            )}

            <div className="mt-4 flex justify-end gap-2">
              {imported ? (
                <Button onClick={backToList}>Ver produtos</Button>
              ) : (
                <Button onClick={() => importMutation.mutate(parsed.items)} disabled={!canImport || importMutation.isPending}>
                  {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
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
