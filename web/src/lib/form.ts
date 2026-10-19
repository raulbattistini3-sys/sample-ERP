// turns a failed zod safeParse into { field: firstMessage } for inline form errors
export const toFieldErrors = <T extends string>(issues: { path: PropertyKey[]; message: string }[]) => {
  const errors: Partial<Record<T, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0] as T;
    errors[field] ??= issue.message;
  }
  return errors;
};

// "" stays NaN so z.number() rejects an empty input instead of reading it as 0; accepts "12,50"
export const toNumber = (value: string) => (value.trim() === "" ? NaN : Number(value.replace(",", ".")));

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time
export const toDateTimeLocal = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

export const formatDateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
};

export const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
