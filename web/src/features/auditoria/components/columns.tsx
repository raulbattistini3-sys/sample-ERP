import { createColumnHelper } from "@tanstack/react-table";
import type { DataTableFeatures } from "../../../components/ui/DataTable";
import { formatDateTime } from "../../../lib/form";
import { Auditoria, acaoEfetuadaLabels } from "../types/auditoria.types";

// the API only sends the auditor's usuario id; the list page resolves it to a name
export type AuditoriaRow = Auditoria & { auditor: string };

const helper = createColumnHelper<DataTableFeatures, AuditoriaRow>();

export const auditoriaColumns = helper.columns([
  helper.accessor("data_de_audicao", {
    header: "Data",
    cell: ({ getValue }) => formatDateTime(getValue()),
  }),
  helper.accessor("acao_efetuada", {
    header: "Ação",
    cell: ({ getValue }) => acaoEfetuadaLabels[getValue()] ?? getValue(),
  }),
  helper.accessor("auditor", { header: "Auditor" }),
  helper.accessor("detalhamento_auditoria_id", {
    header: "Detalhamento",
    cell: ({ getValue }) => (getValue() ? "Sim" : "—"),
  }),
]);
