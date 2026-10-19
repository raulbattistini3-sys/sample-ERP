import { useNavigate } from "react-router-dom";
import { useProducts } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { productColumns } from "../components/columns";

export function ProductListPage() {
  const { data, isLoading } = useProducts();
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Produtos</h2>
        <Button onClick={() => navigate("/products/new")}>Novo produto</Button>
      </div>
      {isLoading ? <p className="text-muted">Carregando...</p> : (
        <DataTable columns={productColumns} data={data} onRowClick={(p) => navigate(`/products/${p.id}`)} />
      )}
    </div>
  );
}
