import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { usuarioColumns } from "../components/columns";
import { USUARIOS_PAGE_SIZE, useUsuarios } from "../hooks/useUsuarios";

// anything missing, non-numeric or below 1 falls back to the first page
const parsePage = (value: string | null) => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

export const UsuarioListPage = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get("page"));
  const { data, isLoading, error, isPlaceholderData } = useUsuarios(page);
  const navigate = useNavigate();
  const location = useLocation();

  // page 1 is the bare /usuarios URL; replace skips the history entry for automatic corrections
  const setPage = (next: number, replace = false) =>
    setSearchParams(next > 1 ? { page: String(next) } : {}, { replace });

  // the form sends the admin back here with the same ?page=
  const openForm = (path: string) => navigate(path, { state: { listSearch: location.search } });

  // step back when the current page empties out (e.g. its last user was deleted)
  const lastPage = data ? Math.max(1, Math.ceil(data.totalItems / USUARIOS_PAGE_SIZE)) : 1;
  useEffect(() => {
    if (data && !isPlaceholderData && page > lastPage) setPage(lastPage, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPage is recreated each render
  }, [data, isPlaceholderData, page, lastPage]);

  // the sidebar already hides this entry for non-admins; this covers typing the URL directly
  if (user?.permissoes !== "ADM") {
    return <ErrorAlert message="Apenas administradores podem gerenciar usuários." />;
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        actions={
          <Button onClick={() => openForm("/usuarios/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo usuário
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar usuários.")} />
      ) : (
        <>
          <DataTable columns={usuarioColumns} data={data?.data} onRowClick={(u) => openForm(`/usuarios/${u.id}`)} />
          {data && (
            <Pagination
              page={page}
              pageSize={USUARIOS_PAGE_SIZE}
              totalItems={data.totalItems}
              onPageChange={(next) => setPage(next)}
            />
          )}
        </>
      )}
    </div>
  );
};
