import { SearchBar, SearchField } from "../../../components/ui/SearchBar";
import { DateRangeFilter, localMidnight } from "../../../components/ui/DateRangeFilter";
import { FilterBar, FilterOption, MultiSelectFilter } from "../../../components/ui/MultiSelectFilter";
import { useListFilters } from "../../../hooks/useListFilters";
import { CategoriaNomesEnum } from "../../categoria/types/categoria.types";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Plus, Upload } from "lucide-react";
import { useDownloadProducts, useProductsScroll } from "../hooks/useProducts";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { LoadMore } from "../../../components/ui/LoadMore";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { isAdminRole } from "../../../lib/permissoes";
import { useUser } from "../../../hooks/useSession";
import { productColumns } from "../components/columns";
import { FakeDataButton } from "../../../components/FakeDataButton";
import { useLocalProducts, useProductEngine } from "../search/useLocalProducts";
import { SearchEngineStatus } from "../search/SearchEngineStatus";

const FILTERS = ["busca", "busca_por", "categoria", "icms", "status", "cadastro_de", "cadastro_ate"] as const;
const SEARCH_FIELDS: SearchField[] = [
  { value: "nome", label: "Nome", placeholder: "Palavra no nome..." },
  { value: "sku", label: "SKU", placeholder: "Parte do SKU..." },
];
const CATEGORIA_OPTIONS: FilterOption[] = CategoriaNomesEnum.options.map((nome) => ({ value: nome, label: nome }));
// the usual rates; a product with another one is still found through the other filters
const ICMS_OPTIONS: FilterOption[] = [0, 4, 7, 12, 17, 18, 19, 20.5].map((r) => ({
  value: String(r),
  label: String(r).replace(".", ",") + "%",
}));
const STATUS_OPTIONS: FilterOption[] = [
  { value: "ativo", label: "Ativo" },
  { value: "inativo", label: "Inativo" },
];

export function ProductListPage() {
  const { openItem } = useListPage();
  const { filters, params, setFilter, setFilters, clear, active } = useListFilters(FILTERS);
  // the URL holds days; the API gets the instants of the user's local midnights, so a product registered
  // late on the 31st here isn't counted as the 1st because the server runs in another time zone
  const apiParams = useMemo(() => {
    const { cadastro_de, cadastro_ate, ...rest } = params;
    return {
      ...rest,
      ...(cadastro_de?.[0] && { cadastro_desde: [localMidnight(cadastro_de[0])] }),
      ...(cadastro_ate?.[0] && { cadastro_antes: [localMidnight(cadastro_ate[0], 1)] }),
    };
  }, [params]);
  // First paint comes from the server (one small page). Once it's on screen, the whole visible list is
  // downloaded as a columnar snapshot and the local engine (pkg/tablecore) takes over: filters and the
  // search bar then run in the browser, on the main thread or in a worker, with no request per keystroke.
  const [firstPagePainted, setFirstPagePainted] = useState(false);
  const { engine, status: engineStatus } = useProductEngine(firstPagePainted);
  const local = useLocalProducts(engine, apiParams);
  const server = useProductsScroll(apiParams, !local.active);
  useEffect(() => {
    if (server.data || server.error) setFirstPagePainted(true);
  }, [server.data, server.error]);
  const serverProducts = useMemo(() => server.data?.pages.flatMap((pagina) => pagina.data) ?? [], [server.data]);
  const products = local.active ? local.products : serverProducts;
  const isLoading = !local.active && server.isLoading;
  const error = local.active ? null : server.error;
  const downloadMutation = useDownloadProducts();
  const user = useUser();

  return (
    <div>
      <PageHeader
        title="Produtos"
        actions={
          <>
            <FakeDataButton tipo="produtos" />
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
      <FilterBar active={active} onClear={clear}>
        <SearchBar
          fields={SEARCH_FIELDS}
          field={filters.busca_por[0] ?? "nome"}
          text={filters.busca[0] ?? ""}
          // the field is kept only alongside a search, so a bare ?busca_por= never sits in the URL
          onChange={(text, by) => setFilters({ busca: text ? [text] : [], busca_por: text && by !== "nome" ? [by] : [] })}
        />
        <MultiSelectFilter label="Categoria" options={CATEGORIA_OPTIONS} selected={filters.categoria} onChange={(v) => setFilter("categoria", v)} />
        <MultiSelectFilter label="ICMS" options={ICMS_OPTIONS} selected={filters.icms} onChange={(v) => setFilter("icms", v)} />
        <DateRangeFilter
          label="Cadastro"
          from={filters.cadastro_de[0]}
          to={filters.cadastro_ate[0]}
          onChange={(de, ate) => setFilters({ cadastro_de: de ? [de] : [], cadastro_ate: ate ? [ate] : [] })}
        />
        {/* only ADM/SU see inactive products */}
        {isAdminRole(user?.permissoes) && <MultiSelectFilter label="Status" options={STATUS_OPTIONS} selected={filters.status} onChange={(v) => setFilter("status", v)} />}
      </FilterBar>
      <SearchEngineStatus mode={local.active ? "local" : engineStatus === "loading" ? "loading" : "server"} run={local.run} />
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
          {local.active ? (
            <LoadMore hasNextPage={local.hasMore} isFetchingNextPage={false} isFetchNextPageError={false} fetchNextPage={local.loadMore} />
          ) : (
            <LoadMore
              hasNextPage={server.hasNextPage}
              isFetchingNextPage={server.isFetchingNextPage}
              isFetchNextPageError={server.isFetchNextPageError}
              fetchNextPage={server.fetchNextPage}
            />
          )}
        </>
      )}
    </div>
  );
}
