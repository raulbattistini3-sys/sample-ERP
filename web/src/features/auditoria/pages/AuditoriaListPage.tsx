import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { LoadMore } from "../../../components/ui/LoadMore";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { AuditoriaRow, auditoriaColumns } from "../components/columns";
import { useAuditorias } from "../hooks/useAuditoria";
import { useAuditorNames } from "../hooks/useAuditorNames";

export const AuditoriaListPage = () => {
  const { openItem } = useListPage();
  const { data, isLoading, error, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useAuditorias();
  const auditorNames = useAuditorNames();

  // the API already returns newest first across pages; the table's own sorting covers the rows loaded so far
  const rows = useMemo<AuditoriaRow[]>(
    () => (data?.pages.flatMap((pagina) => pagina.data) ?? []).map((a) => ({ ...a, auditor: auditorNames.get(a.usuario_id) ?? a.usuario_id })),
    [data, auditorNames],
  );

  return (
    <div>
      <PageHeader
        title="Auditoria"
        actions={
          <Button onClick={() => openItem("/auditoria/new")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova auditoria
          </Button>
        }
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert message={getApiErrorMessage(error, "Erro ao carregar auditorias.")} />
      ) : (
        <>
          <DataTable
            columns={auditoriaColumns}
            data={rows}
            onRowClick={(a) => openItem(`/auditoria/${a.id}`)}
            emptyMessage="Nenhuma auditoria registrada."
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
};
