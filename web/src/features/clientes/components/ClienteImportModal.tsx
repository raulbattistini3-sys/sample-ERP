import { ChangeEvent, useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { ErrorAlert, SuccessAlert } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { downloadTextFile, toCsv } from "../../../lib/csv";
import { SPREADSHEET_ACCEPT } from "../../../lib/spreadsheet";
import { ImportacaoClientes, importacaoClientesTerminou, TipoImportacao } from "../api/clientes.api";
import {
  lembrarImportacao,
  useErrosImportacaoClientes,
  useImportacaoClientes,
  useIniciarImportacaoClientes,
} from "../hooks/useImportacaoClientes";
import { COLUNAS, MAX_CLIENTES_IMPORTACAO, MAX_PLANILHA_CLIENTES_MB, modeloCsv } from "../utils/clientesPlanilha";
import { COLUNAS_EMPRESAS, modeloEmpresasCsv } from "../utils/empresasPlanilha";

const numero = new Intl.NumberFormat("pt-BR");

const TEXTOS: Record<
  TipoImportacao,
  { titulo: string; regra: string; colunas: readonly string[]; modelo: string; csv: () => string; chave: string; sem: string }
> = {
  clientes: {
    titulo: "Importar clientes",
    regra: "O e-mail identifica o cliente: se já existir no HubSpot, ele é atualizado.",
    colunas: COLUNAS,
    modelo: "modelo-clientes.csv",
    csv: modeloCsv,
    chave: "E-mail",
    sem: "sem e-mail",
  },
  empresas: {
    titulo: "Importar empresas",
    regra:
      "Só o Nome é obrigatório e identifica a empresa: se já existir no HubSpot, ela é atualizada (células vazias mantêm o que está lá). O Setor aceita o nome ou o código do HubSpot; o E-mail SAC fica no ERP.",
    colunas: COLUNAS_EMPRESAS,
    modelo: "modelo-empresas.csv",
    csv: modeloEmpresasCsv,
    chave: "Empresa",
    sem: "sem nome",
  },
};

// A .xlsx or .csv with the "Novo cliente" form's columns, up to 500,000 rows. The file goes as it is to the
// Go importer, which reads it as a stream, creates or updates each contact in HubSpot by e-mail in batches
// of 100 (a sheet sent twice changes nobody twice) and links it to its company. The modal follows the
// progress; closing it doesn't stop the import, and reopening it shows the last one again.
// tipo="empresas" is the same flow for the companies template (Go importer, importacao/empresas.go): matched
// by name, created or updated in HubSpot, SAC e-mail kept in the ERP.
export function ClienteImportModal({
  open,
  onClose,
  tipo = "clientes",
}: {
  open: boolean;
  onClose: () => void;
  tipo?: TipoImportacao;
}) {
  const textos = TEXTOS[tipo];
  const lembrar = lembrarImportacao(tipo);
  const iniciar = useIniciarImportacaoClientes(tipo);
  const [id, setId] = useState<string | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const consulta = useImportacaoClientes(id, tipo);
  const importacao = consulta.data;
  const { reset } = iniciar;

  useEffect(() => {
    if (!open) return;
    setErroArquivo(null);
    reset();
    setId(lembrarImportacao(tipo).ler());
  }, [open, reset, tipo]);

  // a remembered import that no longer exists (database reset): forget it
  useEffect(() => {
    if (consulta.error && id) {
      lembrarImportacao(tipo).gravar(null);
      setId(null);
    }
  }, [consulta.error, id, tipo]);

  const escolher = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setErroArquivo(null);
    reset();
    if (!/\.(xlsx|csv)$/i.test(file.name)) return setErroArquivo("Envie uma planilha .xlsx ou .csv.");
    if (file.size > MAX_PLANILHA_CLIENTES_MB * 1024 * 1024) {
      return setErroArquivo(`A planilha passa de ${MAX_PLANILHA_CLIENTES_MB} MB. Divida em partes.`);
    }
    iniciar.mutate(file, {
      onSuccess: (nova) => {
        lembrar.gravar(nova.id);
        setId(nova.id);
      },
    });
  };

  const rodando = !!importacao && !importacaoClientesTerminou(importacao.status);
  const ocupado = iniciar.isPending || rodando;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={iniciar.isPending}
      size="lg"
      title={textos.titulo}
      description={`Planilha .xlsx ou .csv com as colunas ${textos.colunas.join(", ")}, até ${numero.format(MAX_CLIENTES_IMPORTACAO)} linhas. ${textos.regra}`}
      footer={
        <Button type="button" variant="ghost" onClick={onClose} disabled={iniciar.isPending}>
          {rodando ? "Fechar (a importação continua)" : "Fechar"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label
            className={`inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-ink focus-within:ring-2 focus-within:ring-accent/40 ${
              ocupado ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-canvas"
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            {iniciar.isPending ? "Enviando..." : importacao ? "Importar outra planilha" : "Escolher planilha"}
            <input type="file" accept={SPREADSHEET_ACCEPT} className="sr-only" onChange={escolher} disabled={ocupado} />
          </label>
          <Button type="button" variant="ghost" onClick={() => downloadTextFile(textos.modelo, textos.csv())}>
            <Download className="h-4 w-4" aria-hidden="true" /> Baixar modelo
          </Button>
        </div>

        {erroArquivo && <ErrorAlert message={erroArquivo} />}
        {iniciar.error && <ErrorAlert message={getApiErrorMessage(iniciar.error, "Não foi possível enviar a planilha.")} />}
        {importacao && <Progresso importacao={importacao} tipo={tipo} />}
      </div>
    </Modal>
  );
}

const STATUS: Record<ImportacaoClientes["status"], string> = {
  pendente: "Na fila",
  processando: "Importando",
  concluida: "Concluída",
  rejeitada: "Recusada",
  falhou: "Falhou",
};

function Progresso({ importacao: i, tipo }: { importacao: ImportacaoClientes; tipo: TipoImportacao }) {
  const terminou = importacaoClientesTerminou(i.status);
  const pct = i.total_linhas > 0 ? Math.min(100, Math.round((i.linhas_processadas / i.total_linhas) * 100)) : 0;
  const salvos = i.linhas_criadas + i.linhas_atualizadas;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-ink">
          {i.nome_arquivo} · {STATUS[i.status]}
        </p>
        {i.total_linhas > 0 && (
          <p className="text-muted">
            {numero.format(i.linhas_processadas)} de {numero.format(i.total_linhas)} linhas ({pct}%)
          </p>
        )}
      </div>

      {!terminou && (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-canvas"
          role="progressbar"
          aria-label="Progresso da importação"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${i.total_linhas > 0 ? pct : 5}%` }} />
        </div>
      )}

      {(i.status === "rejeitada" || i.status === "falhou") && i.mensagem && <ErrorAlert message={i.mensagem} />}
      {i.status === "concluida" && (
        <SuccessAlert
          message={`${numero.format(i.linhas_criadas)} criado(s), ${numero.format(i.linhas_atualizadas)} atualizado(s)${
            i.linhas_falharam ? `, ${numero.format(i.linhas_falharam)} com problema` : ""
          }.`}
        />
      )}
      {!terminou && salvos > 0 && (
        <p className="text-muted">
          {numero.format(i.linhas_criadas)} criado(s), {numero.format(i.linhas_atualizadas)} atualizado(s) até agora.
        </p>
      )}
      {i.empresas_criadas > 0 && <p className="text-ink">{numero.format(i.empresas_criadas)} empresa(s) criada(s) no HubSpot.</p>}

      {i.linhas_falharam > 0 && <Erros importacao={i} tipo={tipo} />}
    </div>
  );
}

function Erros({ importacao: i, tipo }: { importacao: ImportacaoClientes; tipo: TipoImportacao }) {
  const textos = TEXTOS[tipo];
  const { erros, total, carregando, erro, temMais, mostrarMais, todos } = useErrosImportacaoClientes(i.id, i.linhas_falharam, tipo);
  const [baixando, setBaixando] = useState(false);

  const baixar = async () => {
    setBaixando(true);
    try {
      const lista = await todos();
      downloadTextFile(
        `erros-${i.nome_arquivo.replace(/\.[^.]+$/, "")}.csv`,
        toCsv([["Linha", textos.chave, "Campo", "Problema"], ...lista.map((e) => [e.linha, e.email, e.campo, e.mensagem])]),
      );
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink">
          {numero.format(total)} linha(s) não importada(s){temMais && ` · mostrando ${numero.format(erros.length)}`}
        </p>
        <Button type="button" size="sm" variant="secondary" onClick={baixar} disabled={baixando}>
          <Download className="h-4 w-4" aria-hidden="true" /> {baixando ? "Gerando..." : "Baixar erros (.csv)"}
        </Button>
      </div>
      {erro != null && <ErrorAlert message={getApiErrorMessage(erro, "Não foi possível carregar os erros.")} />}
      <ul className="max-h-56 overflow-auto rounded-md border border-border p-2 text-xs text-red-700">
        {erros.map((e) => (
          <li key={e.seq}>
            Linha {e.linha} ({e.email || textos.sem}): {e.mensagem}
          </li>
        ))}
      </ul>
      {temMais && (
        <Button type="button" size="sm" variant="ghost" onClick={mostrarMais} disabled={carregando}>
          {carregando ? "Carregando..." : "Mostrar mais"}
        </Button>
      )}
    </div>
  );
}
