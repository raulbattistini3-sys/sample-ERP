import { useMemo } from "react";
import { Download, Loader2, Plus, Upload } from "lucide-react";
import { useDownloadProducts, useProductsScroll } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { LoadMore } from "../../../components/ui/LoadMore";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { isAdminRole } from "../../../lib/permissoes";
import { useAuth } from "../../../context/AuthContext";
import { productColumns } from "../components/columns";

export function ProductListPage() {
  const { openItem } = useListPage();
  const { data, isLoading, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useProductsScroll();
  const products = useMemo(() => data?.pages.flatMap((pagina) => pagina.data) ?? [], [data]);
  const downloadMutation = useDownloadProducts();
  const { user } = useAuth();

  return (
    <div>
      <PageHeader
        title="Produtos"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => downloadMutation.mutate()}
              disabled={downloadMutation.isPending || products.length === 0}
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
            data={products}
            onRowClick={(p) => openItem(`/products/${p.id}`)}
            mobileTitleColumnId="name"
          />
          <LoadMore
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetchNextPageError={isFetchNextPageError}
            fetchNextPage={fetchNextPage}
          />
        </>
      )}
    </div>
  );
}
