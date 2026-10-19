import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useProducts } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { productColumns } from "../components/columns";

export function ProductListPage() {
  const { data, isLoading, error } = useProducts();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Produtos"
        actions={
          <Button onClick={() => navigate("/products/new")}>
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
        <DataTable columns={productColumns} data={data} onRowClick={(p) => navigate(`/products/${p.id}`)} />
      )}
    </div>
  );
}
