import { Download, Loader2, Plus, Upload } from "lucide-react";
import { useDownloadProducts, useProducts } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { isAdminRole } from "../../../lib/permissoes";
import { useAuth } from "../../../context/AuthContext";
import { productColumns } from "../components/columns";

export function ProductListPage() {
  const { page, setPage, openItem } = useListPage();
  const { data, isLoading, error, isPlaceholderData } = useProducts(page);
  const downloadMutation = useDownloadProducts();
  const { user } = useAuth();
  useClampPage(page, setPage, data, isPlaceholderData);

  return (
    <div>
      <PageHeader
        title="Produtos"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending || !data?.totalItems}
            >
              {downloadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              Baixar planilha
            </Button>
            {isAdminRole(user?.permissoes) && (
              <Button variant="secondary" onClick={() => openItem("/products/import")}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Importar planilha
              </Button>
            )}
            <Button onClick={() => openItem("/products/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo produto
            </Button>
          </>
        }
      />
      {downloadMutation.isError && (
        <ErrorAlert
          message={getApiErrorMessage(downloadMutation.error, "Não foi possível gerar a planilha.")}
          className="mb-4"
        />
      )}
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar produtos.")} />
      ) : (
        <>
          <DataTable
            columns={productColumns}
            data={data?.data}
            onRowClick={(p) => openItem(`/products/${p.id}`)}
            mobileTitleColumnId="name"
          />
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
