import { createColumnHelper } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import type { DataTableFeatures } from "../../../components/ui/DataTable";
import { Button } from "../../../components/ui/Button";
import { Auditoria } from "../types/auditoria.types";
import { AcaoBadge } from "./AcaoBadge";
import { formatDateTime } from "../utils/format";

const helper = createColumnHelper<DataTableFeatures, Auditoria>();

type AuditoriaColumnsOptions = {
  onViewDetalhamento: (detalhamentoId: string) => void;
  getAuditorName: (usuarioId: string) => string;
};

export const getAuditoriaColumns = ({ onViewDetalhamento, getAuditorName }: AuditoriaColumnsOptions) =>
  helper.columns([
    helper.accessor("data_de_audicao", {
      header: "Data",
      cell: ({ getValue }) => formatDateTime(getValue()),
    }),
    helper.accessor("acao_efetuada", {
      header: "Ação",
      cell: ({ getValue }) => <AcaoBadge acao={getValue()} />,
    }),
    helper.accessor("nome_do_auditor", {
      header: "Auditor",
      cell: ({ getValue }) => getAuditorName(getValue()),
    }),
    helper.accessor("detalhamento_auditoria_id", {
      header: "Detalhamento",
      enableSorting: false,
      cell: ({ getValue }) => {
        const detalhamentoId = getValue();
        if (!detalhamentoId) return <span className="text-muted">—</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation(); // keep the row click (navigate to detail) from firing
              onViewDetalhamento(detalhamentoId);
            }}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Ver
          </Button>
        );
      },
    }),
  ]);
