// HubSpot's internal values (hs_buying_role, hs_seniority) as shown here; an unknown one shows as it came
const papeis: Record<string, string> = {
  DECISION_MAKER: "Decisor",
  BUDGET_HOLDER: "Dono do orçamento",
  CHAMPION: "Defensor",
  EXECUTIVE_SPONSOR: "Patrocinador executivo",
  INFLUENCER: "Influenciador",
  END_USER: "Usuário final",
  LEGAL_AND_COMPLIANCE: "Jurídico e compliance",
  BLOCKER: "Bloqueador",
  OTHER: "Outro",
};

const senioridades: Record<string, string> = {
  owner: "Proprietário",
  partner: "Sócio",
  executive: "Executivo",
  vp: "Vice-presidente",
  director: "Diretor",
  manager: "Gerente",
  senior: "Sênior",
  employee: "Funcionário",
  entry: "Júnior",
};

export const papelLabel = (papel: string) => papeis[papel] ?? papel;
export const senioridadeLabel = (senioridade: string | null) => (senioridade ? (senioridades[senioridade] ?? senioridade) : "—");
