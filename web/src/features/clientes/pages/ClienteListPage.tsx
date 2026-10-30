import { useEffect, useRef, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { Input } from "../../../components/ui/Field";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader, SuccessAlert } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatDateTime } from "../../../lib/form";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { isAdminRole } from "../../../lib/permissoes";
import { Cliente } from "../api/clientes.api";
import { EmpresaCard } from "../components/EmpresaCard";
import { useClientes, useEmpresas, useSincronizarClientes } from "../hooks/useClientes";
import { papelLabel, senioridadeLabel } from "../utils/clientes.labels";

const helper = createColumnHelper<DataTableFeatures, Cliente>();
const columns = helper.columns([
  helper.accessor("nome", { header: "Nome" }),
  helper.accessor("email", { header: "E-mail", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("telefone", { header: "Telefone", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("empresa", { header: "Empresa", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("cargo", { header: "Cargo", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("senioridade", { header: "Senioridade", cell: ({ getValue }) => senioridadeLabel(getValue()) }),
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
]);

// the customers are HubSpot's contacts and companies: read-only here, refreshed with the button
export function ClienteListPage() {
  const { user } = useAuth();
  const { page, setPage } = useListPage();
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"empresas" | "lista">("empresas");
  const [soDecisores, setSoDecisores] = useState(false);
  const clientes = useClientes(page, busca, visao === "lista");
  const empresas = useEmpresas(page, busca, soDecisores, visao === "empresas");
  const syncMutation = useSincronizarClientes();
  const atual = visao === "lista" ? clientes : empresas;
  useClampPage(page, setPage, atual.data, atual.isPlaceholderData);

  // nothing copied yet: fetch from HubSpot once per visit, a failure shows up in the sync alert
  const buscouNoHubspot = useRef(false);
  const copiaVazia = !!atual.data && !atual.isPlaceholderData && atual.data.totalItems === 0 && !busca && !soDecisores;
  useEffect(() => {
    if (!copiaVazia || buscouNoHubspot.current) return;
    buscouNoHubspot.current = true;
    syncMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate only runs on the first empty result
  }, [copiaVazia]);

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem ver os clientes." />;
  }

  const mudarVisao = (proxima: typeof visao) => {
    setVisao(proxima);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        actions={
          <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Sincronizar com o HubSpot
          </Button>
        }
      />
      {syncMutation.isError && (
        <ErrorAlert className="mb-4" message={getApiErrorMessage(syncMutation.error, "Não foi possível sincronizar com o HubSpot.")} />
      )}
      {syncMutation.isSuccess && (
        <SuccessAlert className="mb-4" message={`${syncMutation.data.sincronizados} contato(s) e ${syncMutation.data.empresas} empresa(s) sincronizados, ${syncMutation.data.removidos} removido(s).`} />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button variant={visao === "empresas" ? "primary" : "ghost"} aria-pressed={visao === "empresas"} onClick={() => mudarVisao("empresas")}>
            Por empresa
          </Button>
          <Button variant={visao === "lista" ? "primary" : "ghost"} aria-pressed={visao === "lista"} onClick={() => mudarVisao("lista")}>
            Lista
          </Button>
        </div>
        <div className="w-full max-w-sm">
          <Input
            type="search"
            aria-label="Buscar clientes"
            placeholder={visao === "empresas" ? "Buscar por empresa, domínio ou contato" : "Buscar por nome, e-mail ou empresa"}
            value={busca}
            onChange={(event) => {
              setBusca(event.target.value);
              setPage(1);
            }}
          />
        </div>
        {visao === "empresas" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={soDecisores}
              onChange={(event) => {
                setSoDecisores(event.target.checked);
                setPage(1);
              }}
            />
            Só decisores
          </label>
        )}
      </div>
      {atual.isLoading ? (
        <LoadingState />
      ) : atual.error ? (
        <ErrorAlert message={getApiErrorMessage(atual.error, "Erro ao carregar os clientes.")} />
      ) : (
        <>
          {visao === "lista" ? (
            clientes.data?.data.length === 0 ? (
              <p className="text-sm text-muted">Nenhum cliente encontrado.</p>
            ) : (
              <DataTable columns={columns} data={clientes.data?.data} mobileTitleColumnId="nome" />
            )
          ) : empresas.data?.data.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma empresa encontrada.</p>
          ) : (
            <div className="space-y-4">
              {empresas.data?.data.map((empresa) => (
                <EmpresaCard key={empresa.id} empresa={empresa} />
              ))}
            </div>
          )}
          {atual.data && <Pagination page={page} pageSize={LIST_PAGE_SIZE} totalItems={atual.data.totalItems} onPageChange={(next) => setPage(next)} />}
          {visao === "empresas" && !!empresas.data?.sem_empresa && (
            <p className="mt-2 text-xs text-muted">{empresas.data.sem_empresa} contato(s) sem empresa aparecem só na lista.</p>
          )}
          {visao === "lista" && clientes.data?.sincronizado_em && (
            <p className="mt-2 text-xs text-muted">Última sincronização: {formatDateTime(clientes.data.sincronizado_em)}.</p>
          )}
        </>
      )}
    </div>
  );
}
