import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { useCategorias } from "../hooks/useCategorias";
import { CategoriaTable } from "../components/CategoriaTable";

export function CategoriaListPage() {
  const { page, setPage, openItem } = useListPage();
  const { data, isLoading, error, isPlaceholderData } = useCategorias(page);
  useClampPage(page, setPage, data, isPlaceholderData);

  return (
    <div>
      <PageHeader
        title="Categorias"
        actions={
          <Button onClick={() => openItem("/categorias/new")}>
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
        <>
          <CategoriaTable categorias={data?.data} onRowClick={(c) => openItem(`/categorias/${c.id}`)} />
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
}
