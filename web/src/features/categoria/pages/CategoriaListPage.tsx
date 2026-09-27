import { useCategorias } from "../hooks/useCategorias";
import { CategoriaTable } from "../components/CategoriaTable";

export function CategoriaListPage() {
  const { data: categorias, isLoading, error } = useCategorias();

  if (isLoading) return <p>Carregando...</p>;
  if (error) return <p>Erro ao carregar categorias.</p>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Categorias</h1>
      <CategoriaTable categorias={categorias ?? []} />
    </div>
  );
}
