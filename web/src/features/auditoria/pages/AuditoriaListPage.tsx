import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuditorias } from "../hooks/useAuditoria";
import { useAuditorName } from "../hooks/useAuditorName";
import { DataTable } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { getAuditoriaColumns } from "../components/columns";
import { DetalhamentoAuditoriaModal } from "../components/DetalhamentoAuditoriaModal";

export function AuditoriaListPage() {
  const { data, isLoading, error } = useAuditorias();
  const navigate = useNavigate();
  const getAuditorName = useAuditorName();
  const [detalhamentoId, setDetalhamentoId] = useState<string | null>(null);

  const columns = useMemo(
    () => getAuditoriaColumns({ onViewDetalhamento: setDetalhamentoId, getAuditorName }),
    [getAuditorName],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Auditorias</h2>
        <Button onClick={() => navigate("/auditoria/new")}>Nova auditoria</Button>
      </div>
      {isLoading ? (
        <p className="text-muted">Carregando...</p>
      ) : error ? (
        <p className="text-danger">Erro ao carregar auditorias.</p>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(a) => navigate(`/auditoria/${a.id}`)}
          emptyMessage="Nenhuma auditoria registrada."
        />
      )}
      <DetalhamentoAuditoriaModal detalhamentoId={detalhamentoId} onClose={() => setDetalhamentoId(null)} />
    </div>
  );
}
