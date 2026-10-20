import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { isAdminRole } from "../../../lib/permissoes";
import { usuarioColumns } from "../components/columns";
import { useUsuarios } from "../hooks/useUsuarios";

export const UsuarioListPage = () => {
  const { user } = useAuth();
  const { page, setPage, openItem } = useListPage();
  const { data, isLoading, error, isPlaceholderData } = useUsuarios(page);
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
          <Button onClick={() => openItem("/usuarios/new")}>
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
