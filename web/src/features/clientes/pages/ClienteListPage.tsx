import { useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, ExternalLink, FileSpreadsheet, UserPlus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { Input } from "../../../components/ui/Field";
import { LoadMore } from "../../../components/ui/LoadMore";
import { PorPagina } from "../../../components/ui/PorPagina";
import { usePorPagina } from "../../../hooks/usePorPagina";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { FakeDataButton } from "../../../components/FakeDataButton";
import { useUser } from "../../../hooks/useSession";
import { SHOW_SEARCH_TIMINGS } from "../../../lib/ambiente";
import { getApiErrorMessage } from "../../../lib/api-client";
import { isAdminRole } from "../../../lib/permissoes";
import { Cliente, getCliente } from "../api/clientes.api";
import { ClienteAcoes, ClienteResumo, Senioridade } from "../components/ClienteAcoes";
import { ClienteFormModal } from "../components/ClienteFormModal";
import { ClienteImportModal } from "../components/ClienteImportModal";
import { PagamentoMensalModal } from "../../cobrancas/components/PagamentoMensalModal";
import { EmpresaCard } from "../components/EmpresaCard";
import { useClientes, useEmpresas } from "../hooks/useClientes";
import { papelLabel } from "../utils/clientes.labels";
import { TipoAtividade } from "../api/atividades.api";
import { AlvoDaAtividade, AtividadeModal } from "../components/AtividadeModal";
import { FunilBoard } from "../components/FunilBoard";

const helper = createColumnHelper<DataTableFeatures, Cliente>();
const criarColunas = (
  onEditar: (id: string) => void,
  onPagamento: (c: ClienteResumo) => void,
  onAtividade: (c: ClienteResumo, tipo: TipoAtividade) => void,
) =>
  helper.columns([
    helper.accessor("nome", { header: "Nome" }),
    helper.accessor("email", { header: "E-mail", cell: ({ getValue }) => getValue() ?? "—" }),
    helper.accessor("telefone", { header: "Telefone", cell: ({ getValue }) => getValue() ?? "—" }),
    helper.accessor("empresa", { header: "Empresa", cell: ({ getValue }) => getValue() ?? "—" }),
    helper.accessor("cargo", { header: "Cargo", cell: ({ getValue }) => getValue() ?? "—" }),
    helper.accessor("senioridade", {
      header: "Senioridade",
      cell: ({ getValue, row }) => <Senioridade valor={getValue()} origem={row.original.senioridadeOrigem} />,
    }),
    helper.accessor("papeis", { header: "Papéis", cell: ({ getValue }) => getValue().map(papelLabel).join(", ") || "—" }),
    helper.accessor("url", {
      header: "HubSpot",
      cell: ({ getValue }) => {
        const url = getValue();
        return url ? (
          <a href={url} target="_blank" rel="noreferrer" aria-label="Abrir no HubSpot" className="inline-flex text-accent hover:underline">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : (
          "—"
        );
      },
    }),
    helper.display({
      id: "acoes",
      header: "Ações",
      cell: ({ row }) => <ClienteAcoes cliente={row.original} onEditar={onEditar} onPagamento={onPagamento} onAtividade={onAtividade} />,
    }),
  ]);

const BUSCA_DEBOUNCE_MS = 300;
const contagem = new Intl.NumberFormat("pt-BR");
const milis = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

// the customers are HubSpot's contacts and companies, read live; created and edited here and written back
// to HubSpot, except senioridade, which the ERP keeps
export function ClienteListPage() {
  const user = useUser();
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"empresas" | "lista" | "funil">("empresas");
  const [soDecisores, setSoDecisores] = useState(false);
  const clientes = useClientes(busca, visao === "lista");
  const [porPagina, setPorPagina] = usePorPagina("clientes-empresas", 10);
  const empresas = useEmpresas(busca, soDecisores, visao === "empresas", porPagina);
  // the Funil loads its own columns (FunilBoard); the timing line and paging follow the other views
  const atual = visao === "lista" ? clientes : empresas;
  const linhas = useMemo(() => clientes.data?.pages.flatMap((pagina) => pagina.data) ?? [], [clientes.data]);
  const cards = useMemo(() => empresas.data?.pages.flatMap((pagina) => pagina.data) ?? [], [empresas.data]);
  const semEmpresa = empresas.data?.pages[0]?.sem_empresa;
  // the dev timing line: the last page loaded and what it cost (the same numbers go to telemetry)
  const ultimaPagina = atual.data?.pages.at(-1);

  // the client form: { id: null } is a new client; an id is read in full first (a company's card has a summary)
  const [formulario, setFormulario] = useState<{ id: string | null } | null>(null);
  const [pagamento, setPagamento] = useState<ClienteResumo | null>(null);
  const [importando, setImportando] = useState<"clientes" | "empresas" | null>(null);
  // note / e-mail / meeting shortcut; `n` remounts the modal so each one starts empty
  const [atividade, setAtividade] = useState<{ alvo: AlvoDaAtividade; tipo: TipoAtividade; n: number } | null>(null);
  const abrirAtividade = (alvo: AlvoDaAtividade, tipo: TipoAtividade) => setAtividade({ alvo, tipo, n: Date.now() });
  const editandoId = formulario?.id ?? null;
  const editando = useQuery({ queryKey: ["clientes", "um", editandoId], queryFn: () => getCliente(editandoId!), enabled: !!editandoId, staleTime: 0 });
  const colunas = useMemo(
    () =>
      criarColunas(
        (id) => setFormulario({ id }),
        setPagamento,
        (c, tipo) => setAtividade({ alvo: { contatoId: c.id, nome: c.nome, email: c.email }, tipo, n: Date.now() }),
      ),
    [],
  );

  // each search is a request to HubSpot, which allows only a few per second
  useEffect(() => {
    const timer = setTimeout(() => setBusca(digitado.trim()), BUSCA_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [digitado]);

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem ver os clientes." />;
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        actions={
          <>
            <FakeDataButton tipo="clientes" />
            <Button variant="secondary" onClick={() => setImportando("clientes")}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Importar clientes
            </Button>
            <Button variant="secondary" onClick={() => setImportando("empresas")}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Importar empresas
            </Button>
            <Link
              to="/clientes/empresas/new"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas"
            >
              <Building2 className="h-4 w-4" aria-hidden="true" /> Nova empresa
            </Link>
            <Button onClick={() => setFormulario({ id: null })}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Novo cliente
            </Button>
          </>
        }
      />
      {editandoId && editando.isLoading && <LoadingState label="Abrindo o cliente..." />}
      {editandoId && editando.error && (
        <ErrorAlert className="mb-4" message={getApiErrorMessage(editando.error, "Não foi possível abrir o cliente.")} />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button variant={visao === "empresas" ? "primary" : "ghost"} aria-pressed={visao === "empresas"} onClick={() => setVisao("empresas")}>
            Por empresa
          </Button>
          <Button variant={visao === "lista" ? "primary" : "ghost"} aria-pressed={visao === "lista"} onClick={() => setVisao("lista")}>
            Lista
          </Button>
          <Button variant={visao === "funil" ? "primary" : "ghost"} aria-pressed={visao === "funil"} onClick={() => setVisao("funil")}>
            Funil
          </Button>
        </div>
        <div className="w-full max-w-sm">
          <Input
            type="search"
            aria-label="Buscar clientes"
            placeholder={visao === "lista" ? "Buscar por nome, e-mail ou empresa" : "Buscar por empresa ou domínio"}
            value={digitado}
            onChange={(event) => setDigitado(event.target.value)}
          />
        </div>
        {visao === "empresas" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={soDecisores}
              onChange={(event) => setSoDecisores(event.target.checked)}
            />
            Só decisores
          </label>
        )}
        {visao === "empresas" && <PorPagina id="empresas-por-pagina" valor={porPagina} onChange={setPorPagina} />}
      </div>
      {SHOW_SEARCH_TIMINGS && visao !== "funil" && ultimaPagina && (
        <p className="-mt-2 mb-3 text-xs text-muted" data-testid="clientes-search-status" data-ms={Math.round(ultimaPagina.ms)}>
          {contagem.format(ultimaPagina.totalItems)} {visao === "lista" ? "clientes" : "empresas"} ·{" "}
          {milis.format(ultimaPagina.ms)} ms (rede, API + HubSpot) · lida {ultimaPagina.alvo === "worker" ? "no worker" : "na thread principal"}
          {atual.isFetching ? " · buscando…" : ""}
        </p>
      )}
      {visao === "funil" ? (
        <FunilBoard busca={busca} onAtividade={abrirAtividade} />
      ) : atual.isLoading ? (
        <LoadingState />
      ) : atual.error ? (
        <ErrorAlert message={getApiErrorMessage(atual.error, "Erro ao carregar os clientes.")} />
      ) : (
        <>
          {visao === "lista" ? (
            linhas.length === 0 ? (
              <p className="text-sm text-muted">Nenhum cliente encontrado.</p>
            ) : (
              <DataTable columns={colunas} data={linhas} mobileTitleColumnId="nome" />
            )
          ) : cards.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma empresa encontrada.</p>
          ) : (
            <div className="space-y-4">
              {cards.map((empresa) => (
                <EmpresaCard
                  key={empresa.id}
                  empresa={empresa}
                  onEditar={(id) => setFormulario({ id })}
                  onPagamento={setPagamento}
                  onAtividade={abrirAtividade}
                />
              ))}
            </div>
          )}
          <LoadMore
            hasNextPage={atual.hasNextPage}
            isFetchingNextPage={atual.isFetchingNextPage}
            isFetchNextPageError={atual.isFetchNextPageError}
            fetchNextPage={atual.fetchNextPage}
            botao={
              visao === "empresas" && cards.length > 0
                ? { quantidade: porPagina, carregados: cards.length, total: empresas.data?.pages.at(-1)?.totalItems ?? cards.length }
                : undefined
            }
          />
          {visao === "empresas" && !!semEmpresa && (
            <p className="mt-2 text-xs text-muted">{semEmpresa} contato(s) sem empresa aparecem só na lista.</p>
          )}
        </>
      )}
      <ClienteFormModal
        open={formulario !== null && (formulario.id === null || !!editando.data)}
        cliente={formulario?.id ? (editando.data ?? null) : null}
        onClose={() => setFormulario(null)}
      />
      <PagamentoMensalModal open={pagamento !== null} cliente={pagamento} onClose={() => setPagamento(null)} />
      <ClienteImportModal open={importando !== null} tipo={importando ?? "clientes"} onClose={() => setImportando(null)} />
      {atividade && (
        <AtividadeModal key={atividade.n} open alvo={atividade.alvo} tipoInicial={atividade.tipo} onClose={() => setAtividade(null)} />
      )}
    </div>
  );
}
