import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { useCategorias } from "../hooks/useCategorias";
import { CategoriaTable } from "../components/CategoriaTable";

export function CategoriaListPage() {
  const { data: categorias, isLoading, error } = useCategorias();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Categorias"
        actions={
          <Button onClick={() => navigate("/categorias/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova categoria
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar categorias.")} />
      ) : (
        <CategoriaTable categorias={categorias} onRowClick={(c) => navigate(`/categorias/${c.id}`)} />
      )}
    </div>
  );
}
