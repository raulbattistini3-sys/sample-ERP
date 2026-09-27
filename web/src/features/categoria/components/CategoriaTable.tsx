import { Table } from "../../../components/ui/Table";
import { Categoria } from "../types/categoria.types";

export function CategoriaTable({ categorias }: { categorias: Categoria[] }) {
    return (
    <Table
      columns={["Nome", "Tipo", "Status"]}
      rows={categorias.map((c) => [c.nome, c.tipo, c.ativo ? "Ativo" : "Inativo"])}
    />
  );
}
