import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { DataTable } from "../../../components/ui/DataTable";
import { ErrorAlert, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { AuditoriaRow, auditoriaColumns } from "../components/columns";
import { useAuditorias } from "../hooks/useAuditoria";
import { useAuditorNames } from "../hooks/useAuditorNames";

export const AuditoriaListPage = () => {
  const { data, isLoading, error } = useAuditorias();
  const auditorNames = useAuditorNames();
  const navigate = useNavigate();

  // newest first; the table's own sorting still works on top of this
  const rows = useMemo<AuditoriaRow[]>(
    () =>
      (data ?? [])
        .map((a) => ({ ...a, auditor: auditorNames.get(a.nome_do_auditor) ?? a.nome_do_auditor }))
        .sort((a, b) => b.data_de_audicao.localeCompare(a.data_de_audicao)),
    [data, auditorNames],
  );

  return (
    <div>
      <PageHeader
        title="Auditoria"
        actions={
          <Button onClick={() => navigate("/auditoria/new")}>
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
        <DataTable
          columns={auditoriaColumns}
          data={rows}
          onRowClick={(a) => navigate(`/auditoria/${a.id}`)}
          emptyMessage="Nenhuma auditoria registrada."
        />
      )}
    </div>
  );
};
