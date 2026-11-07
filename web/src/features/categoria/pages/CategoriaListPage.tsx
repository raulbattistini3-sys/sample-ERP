import { FilterBar, FilterOption, MultiSelectFilter } from "../../../components/ui/MultiSelectFilter";
import { useListFilters } from "../../../hooks/useListFilters";
import { CategoriaNomesEnum, CategoriaTiposEnum } from "../types/categoria.types";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { FakeDataButton } from "../../../components/FakeDataButton";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { useCategorias } from "../hooks/useCategorias";
import { CategoriaTable } from "../components/CategoriaTable";

const FILTERS = ["nome", "tipo", "status"] as const;
const NOME_OPTIONS: FilterOption[] = CategoriaNomesEnum.options.map((nome) => ({ value: nome, label: nome }));
const TIPO_OPTIONS: FilterOption[] = CategoriaTiposEnum.options.map((tipo) => ({ value: tipo, label: tipo }));
const STATUS_OPTIONS: FilterOption[] = [
  { value: "ativo", label: "Ativo" },
  { value: "inativo", label: "Inativo" },
];

export function CategoriaListPage() {
  const { page, setPage, openItem } = useListPage();
  const { filters, params, setFilter, clear, active } = useListFilters(FILTERS);
  const { data, isLoading, error, isPlaceholderData } = useCategorias(page, undefined, params);
  useClampPage(page, setPage, data, isPlaceholderData);

  return (
    <div>
      <PageHeader
        title="Categorias"
        actions={
          <>
            <FakeDataButton tipo="categorias" />
            <Button onClick={() => openItem("/categorias/new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova categoria
            </Button>
          </>
        }
      />
      <FilterBar active={active} onClear={clear}>
        <MultiSelectFilter label="Nome" options={NOME_OPTIONS} selected={filters.nome} onChange={(v) => setFilter("nome", v)} />
        <MultiSelectFilter label="Tipo" options={TIPO_OPTIONS} selected={filters.tipo} onChange={(v) => setFilter("tipo", v)} />
        <MultiSelectFilter label="Status" options={STATUS_OPTIONS} selected={filters.status} onChange={(v) => setFilter("status", v)} />
      </FilterBar>
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
