import { FilterBar, FilterOption, MultiSelectFilter } from "../../../components/ui/MultiSelectFilter";
import { useListFilters } from "../../../hooks/useListFilters";
import { PermissoesEnum, permissoesLabels } from "../types/usuario.types";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { FakeDataButton } from "../../../components/FakeDataButton";
import { useUser } from "../../../hooks/useSession";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { isAdminRole } from "../../../lib/permissoes";
import { usuarioColumns } from "../components/columns";
import { useUsuarios } from "../hooks/useUsuarios";

const FILTERS = ["permissoes", "status"] as const;
const PERMISSAO_OPTIONS: FilterOption[] = PermissoesEnum.options.map((p) => ({ value: p, label: permissoesLabels[p] }));
const STATUS_OPTIONS: FilterOption[] = [
  { value: "ativo", label: "Ativo" },
  { value: "inativo", label: "Inativo" },
];

export const UsuarioListPage = () => {
  const user = useUser();
  const { page, setPage, openItem } = useListPage();
  const { filters, params, setFilter, clear, active } = useListFilters(FILTERS);
  const { data, isLoading, error, isPlaceholderData } = useUsuarios(page, undefined, params);
  useClampPage(page, setPage, data, isPlaceholderData);

  // the sidebar already hides this entry for non-admins; this covers typing the URL directly
  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem gerenciar usuários." />;
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        actions={
          <>
            <FakeDataButton tipo="usuarios" />
            <Button onClick={() => openItem("/usuarios/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo usuário
            </Button>
          </>
        }
      />
      <FilterBar active={active} onClear={clear}>
        <MultiSelectFilter label="Permissão" options={PERMISSAO_OPTIONS} selected={filters.permissoes} onChange={(v) => setFilter("permissoes", v)} />
        <MultiSelectFilter label="Status" options={STATUS_OPTIONS} selected={filters.status} onChange={(v) => setFilter("status", v)} />
      </FilterBar>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar usuários.")} />
      ) : (
        <>
          <DataTable columns={usuarioColumns} data={data?.data} onRowClick={(u) => openItem(`/usuarios/${u.id}`)} />
          {data && (
            <Pagination
              page={page}
              pageSize={LIST_PAGE_SIZE}
              totalItems={data.totalItems}
              onPageChange={(next) => setPage(next)}
            />
          )}
        </>
      )}
    </div>
  );
};
