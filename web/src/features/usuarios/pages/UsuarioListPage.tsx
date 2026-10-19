import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useAuth } from "../../../context/AuthContext";
import { getApiErrorMessage } from "../../../lib/api-client";
import { usuarioColumns } from "../components/columns";
import { useUsuarios } from "../hooks/useUsuarios";

export const UsuarioListPage = () => {
  const { user } = useAuth();
  const { data, isLoading, error } = useUsuarios();
  const navigate = useNavigate();

  // the sidebar already hides this entry for non-admins; this covers typing the URL directly
  if (user?.permissoes !== "ADM") {
    return <ErrorAlert message="Apenas administradores podem gerenciar usuários." />;
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        actions={
          <Button onClick={() => navigate("/usuarios/new")}>
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
        <DataTable columns={usuarioColumns} data={data} onRowClick={(u) => navigate(`/usuarios/${u.id}`)} />
      )}
    </div>
  );
};
