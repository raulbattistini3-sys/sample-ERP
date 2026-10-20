import { Plus } from "lucide-react";
import { useProducts } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { productColumns } from "../components/columns";

export function ProductListPage() {
  const { page, setPage, openItem } = useListPage();
  const { data, isLoading, error, isPlaceholderData } = useProducts(page);
  useClampPage(page, setPage, data, isPlaceholderData);

  return (
    <div>
      <PageHeader
        title="Produtos"
        actions={
          <Button onClick={() => openItem("/products/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo produto
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar produtos.")} />
      ) : (
        <>
          <DataTable columns={productColumns} data={data?.data} onRowClick={(p) => openItem(`/products/${p.id}`)} />
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
