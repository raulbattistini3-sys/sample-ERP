import { createColumnHelper } from "@tanstack/react-table";
import type { DataTableFeatures } from "../../../components/ui/DataTable";
import { StatusBadge } from "../../../components/ui/PageState";
import { Usuario } from "../types/usuario.types";

const helper = createColumnHelper<DataTableFeatures, Usuario>();

export const usuarioColumns = helper.columns([
  helper.accessor("nome", { header: "Nome" }),
  helper.accessor("email", { header: "E-mail" }),
  helper.accessor("permissoes", {
    header: "Permissão",
    cell: ({ getValue }) => (getValue() === "ADM" ? "Administrador" : "Estoque"),
  }),
  helper.accessor("ativo", {
    header: "Status",
    cell: ({ getValue }) => <StatusBadge active={getValue()} />,
  }),
]);
