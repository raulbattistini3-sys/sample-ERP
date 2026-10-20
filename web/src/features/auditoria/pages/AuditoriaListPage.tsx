import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { Pagination } from "../../../components/ui/Pagination";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { useClampPage, useListPage } from "../../../hooks/useListPage";
import { getApiErrorMessage } from "../../../lib/api-client";
import { LIST_PAGE_SIZE } from "../../../lib/pagination";
import { AuditoriaRow, auditoriaColumns } from "../components/columns";
import { useAuditorias } from "../hooks/useAuditoria";
import { useAuditorNames } from "../hooks/useAuditorNames";

export const AuditoriaListPage = () => {
  const { page, setPage, openItem } = useListPage();
  const { data, isLoading, error, isPlaceholderData } = useAuditorias(page);
  useClampPage(page, setPage, data, isPlaceholderData);
  const auditorNames = useAuditorNames();

  // the API already returns newest first across pages; the table's own sorting still works within a page
  const rows = useMemo<AuditoriaRow[]>(
    () => (data?.data ?? []).map((a) => ({ ...a, auditor: auditorNames.get(a.nome_do_auditor) ?? a.nome_do_auditor })),
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
};
