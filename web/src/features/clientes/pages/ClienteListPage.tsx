import { useState } from "react";
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
import { useClientes, useSincronizarClientes } from "../hooks/useClientes";

const helper = createColumnHelper<DataTableFeatures, Cliente>();
const columns = helper.columns([
  helper.accessor("nome", { header: "Nome" }),
  helper.accessor("email", { header: "E-mail", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("telefone", { header: "Telefone", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("empresa", { header: "Empresa", cell: ({ getValue }) => getValue() ?? "—" }),
  helper.accessor("estagio", { header: "Estágio", cell: ({ getValue }) => getValue() ?? "—" }),
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

// the customers are HubSpot's contacts: read-only here, refreshed with the button
export function ClienteListPage() {
  const { user } = useAuth();
  const { page, setPage } = useListPage();
  const [busca, setBusca] = useState("");
  const { data, isLoading, error, isPlaceholderData } = useClientes(page, busca);
  const syncMutation = useSincronizarClientes();
  useClampPage(page, setPage, data, isPlaceholderData);

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem ver os clientes." />;
  }

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
        <SuccessAlert className="mb-4" message={`${syncMutation.data.sincronizados} cliente(s) sincronizado(s), ${syncMutation.data.removidos} removido(s).`} />
      )}
      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          aria-label="Buscar clientes"
          placeholder="Buscar por nome, e-mail ou empresa"
          value={busca}
          onChange={(event) => {
            setBusca(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar os clientes.")} />
      ) : (
        <>
          <DataTable columns={columns} data={data?.data} mobileTitleColumnId="nome" />
          {data && <Pagination page={page} pageSize={LIST_PAGE_SIZE} totalItems={data.totalItems} onPageChange={(next) => setPage(next)} />}
          {data?.sincronizado_em && <p className="mt-2 text-xs text-muted">Última sincronização: {formatDateTime(data.sincronizado_em)}.</p>}
        </>
      )}
    </div>
  );
}
