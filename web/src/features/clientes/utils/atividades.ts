import { CalendarPlus, Mail, StickyNote } from "lucide-react";
import { TipoAtividade } from "../api/atividades.api";

// the shortcuts (note, e-mail, meeting) and their icons, shared by the buttons and the modal tabs
export const ATIVIDADES: { tipo: TipoAtividade; label: string; Icone: typeof StickyNote }[] = [
  { tipo: "nota", label: "Nota", Icone: StickyNote },
  { tipo: "email", label: "E-mail", Icone: Mail },
  { tipo: "reuniao", label: "Reunião", Icone: CalendarPlus },
];
