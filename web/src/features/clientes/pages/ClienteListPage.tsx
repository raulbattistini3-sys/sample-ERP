import { useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable, type DataTableFeatures } from "../../../components/ui/DataTable";
import { Input } from "../../../components/ui/Field";
import { LoadMore } from "../../../components/ui/LoadMore";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { isAdminRole } from "../../../lib/permissoes";
import { Cliente } from "../api/clientes.api";
import { EmpresaCard } from "../components/EmpresaCard";
import { useClientes, useEmpresas } from "../hooks/useClientes";
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

const BUSCA_DEBOUNCE_MS = 300;

// the customers are HubSpot's contacts and companies, read live and read-only here
export function ClienteListPage() {
  const { user } = useAuth();
  const [digitado, setDigitado] = useState("");
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"empresas" | "lista">("empresas");
  const [soDecisores, setSoDecisores] = useState(false);
  const clientes = useClientes(busca, visao === "lista");
  const empresas = useEmpresas(busca, soDecisores, visao === "empresas");
  const atual = visao === "lista" ? clientes : empresas;
  const linhas = useMemo(() => clientes.data?.pages.flatMap((pagina) => pagina.data) ?? [], [clientes.data]);
  const cards = useMemo(() => empresas.data?.pages.flatMap((pagina) => pagina.data) ?? [], [empresas.data]);
  const semEmpresa = empresas.data?.pages[0]?.sem_empresa;

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
      <PageHeader title="Clientes" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button variant={visao === "empresas" ? "primary" : "ghost"} aria-pressed={visao === "empresas"} onClick={() => setVisao("empresas")}>
            Por empresa
          </Button>
          <Button variant={visao === "lista" ? "primary" : "ghost"} aria-pressed={visao === "lista"} onClick={() => setVisao("lista")}>
            Lista
          </Button>
        </div>
        <div className="w-full max-w-sm">
          <Input
            type="search"
            aria-label="Buscar clientes"
            placeholder={visao === "empresas" ? "Buscar por empresa ou domínio" : "Buscar por nome, e-mail ou empresa"}
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
      </div>
      {atual.isLoading ? (
        <LoadingState />
      ) : atual.error ? (
        <ErrorAlert message={getApiErrorMessage(atual.error, "Erro ao carregar os clientes.")} />
      ) : (
        <>
          {visao === "lista" ? (
            linhas.length === 0 ? (
              <p className="text-sm text-muted">Nenhum cliente encontrado.</p>
            ) : (
              <DataTable columns={columns} data={linhas} mobileTitleColumnId="nome" />
            )
          ) : cards.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma empresa encontrada.</p>
          ) : (
            <div className="space-y-4">
              {cards.map((empresa) => (
                <EmpresaCard key={empresa.id} empresa={empresa} />
              ))}
            </div>
          )}
          <LoadMore
            hasNextPage={atual.hasNextPage}
            isFetchingNextPage={atual.isFetchingNextPage}
            isFetchNextPageError={atual.isFetchNextPageError}
            fetchNextPage={atual.fetchNextPage}
          />
          {visao === "empresas" && !!semEmpresa && (
            <p className="mt-2 text-xs text-muted">{semEmpresa} contato(s) sem empresa aparecem só na lista.</p>
          )}
        </>
      )}
    </div>
  );
}
