// "1.234,56" or "1234.56" → 1234.56
export const parseReais = (text: string) => {
  const t = text.trim().replace(/[R$\s]/g, "");
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return t === "" || !Number.isFinite(n) ? NaN : n;
};

// 1234.5 → "1234,50", for putting a value back into an input
export const reaisInput = (centavos: number | null) => (centavos == null ? "" : (centavos / 100).toFixed(2).replace(".", ","));

// YYYY-MM-DD → dd/mm/yyyy without going through Date (new Date("2026-11-13") is midnight UTC, the 12th in Brazil)
export const formatDia = (iso: string | null) => {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
};

// today in Brazil as YYYY-MM-DD (the API schedules in America/Sao_Paulo)
export const hojeISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

// the plan's cycle n, as the API computes it: months clamp to the month's last day without drifting
// (Jan 31 monthly → Feb 28, Mar 31, Apr 30)
export const dataDoCiclo = (inicio: string, intervalo: number, unidade: "dias" | "meses", n: number) => {
  const [a, m, d] = inicio.split("-").map(Number);
  if (unidade === "dias") {
    const t = new Date(Date.UTC(a, m - 1, d + n * intervalo));
    return t.toISOString().slice(0, 10);
  }
  const meses = m - 1 + n * intervalo;
  const ano = a + Math.floor(meses / 12);
  const mes = meses % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
};

export const frequenciaLabel = (intervalo: number, unidade: "dias" | "meses") =>
  unidade === "meses"
    ? intervalo === 1 ? "Todo mês" : `A cada ${intervalo} meses`
    : intervalo === 1 ? "Todo dia" : intervalo === 7 ? "Toda semana" : `A cada ${intervalo} dias`;
