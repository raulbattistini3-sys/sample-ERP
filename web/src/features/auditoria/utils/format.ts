const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
};

// decimals arrive as strings ("10.00") from the api
export const formatCurrency = (value: string | number) => currencyFormatter.format(Number(value));

export const acaoLabels = {
  Criacao: "Criação",
  Alteracao: "Alteração",
  Delecao: "Deleção",
} as const;
