import { useEffect, useRef, useState } from "react";
import { InfiniteData, QueryClient, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../../lib/auth-storage";
import { FaturaPagaEvento, FaturaRecente, PaginaDeFaturas } from "../api/cobrancas.api";

// Listens to GET /cobrancas/eventos (Server-Sent Events) while the Cobranças page is open: when the billing
// webhook reports a payment, the invoice turns "Paga" in the lists on screen right away, without waiting for
// the next poll or for Stripe's search index (about a minute behind). Read with fetch, not EventSource, because
// EventSource can't send the Authorization header. Reconnects after a drop, waiting longer each time (max 30 s).

export type EstadoEventos = "conectando" | "ao-vivo" | "reconectando";

const pagaAgora = (f: FaturaRecente, e: FaturaPagaEvento): FaturaRecente => ({
  ...f,
  status: "paid",
  pagoCentavos: e.valorCentavos,
  pagaEm: e.pagaEm,
});

const deEvento = (e: FaturaPagaEvento): FaturaRecente => ({
  id: e.faturaId,
  numero: e.numero,
  status: "paid",
  clienteNome: e.nome,
  clienteEmail: e.email,
  valorCentavos: e.valorCentavos,
  pagoCentavos: e.valorCentavos,
  criadaEm: e.pagaEm,
  vencimento: null,
  url: e.url,
  emissor: null,
  pagaEm: e.pagaEm,
});

const aplicar = (queryClient: QueryClient, e: FaturaPagaEvento) => {
  // "Cobranças recentes": the invoice was there as "Em aberto"
  queryClient.setQueryData<FaturaRecente[]>(["cobrancas", "recentes"], (lista) =>
    lista?.map((f) => (f.id === e.faturaId ? pagaAgora(f, e) : f)),
  );
  // "Pagas": goes on top of the first page, once
  queryClient.setQueriesData<InfiniteData<PaginaDeFaturas, string | null>>({ queryKey: ["cobrancas", "pagas"] }, (dados) => {
    if (!dados?.pages.length) return dados;
    if (dados.pages.some((p) => p.faturas.some((f) => f.id === e.faturaId))) return dados;
    const [primeira, ...resto] = dados.pages;
    return {
      ...dados,
      pages: [{ ...primeira, faturas: [deEvento(e), ...primeira.faturas] }, ...resto],
    };
  });
  // the plans' cycle history shows the invoice's status too
  queryClient.invalidateQueries({ queryKey: ["cobrancas", "recorrentes"] });
};

// one SSE frame ("event: …\ndata: …"), already split on the blank line
const lerQuadro = (quadro: string): { evento: string; dados: string } | null => {
  let evento = "message";
  const dados: string[] = [];
  for (const linha of quadro.split("\n")) {
    if (linha.startsWith(":")) continue; // heartbeat comment
    const i = linha.indexOf(":");
    const campo = i === -1 ? linha : linha.slice(0, i);
    const valor = i === -1 ? "" : linha.slice(i + 1).replace(/^ /, "");
    if (campo === "event") evento = valor;
    else if (campo === "data") dados.push(valor);
  }
  return dados.length ? { evento, dados: dados.join("\n") } : null;
};

export function useEventosDeCobranca(aoPagar?: (e: FaturaPagaEvento) => void): EstadoEventos {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<EstadoEventos>("conectando");
  // the latest callback, without reconnecting the stream when it changes
  const callback = useRef(aoPagar);
  useEffect(() => {
    callback.current = aoPagar;
  });

  useEffect(() => {
    const controle = new AbortController();
    let espera = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const conectar = async () => {
      try {
        const token = getToken();
        const resposta = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/cobrancas/eventos`, {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controle.signal,
          cache: "no-store",
        });
        // 401/403 won't fix themselves by retrying; the rest of the page already shows the session problem
        if (resposta.status === 401 || resposta.status === 403) return;
        if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);
        setEstado("ao-vivo");
        espera = 1000;
        // whatever happened while disconnected comes with a fresh read
        queryClient.invalidateQueries({ queryKey: ["cobrancas", "recentes"] });

        const leitor = resposta.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          buffer += value.replace(/\r\n?/g, "\n");
          let fim: number;
          while ((fim = buffer.indexOf("\n\n")) !== -1) {
            const quadro = lerQuadro(buffer.slice(0, fim));
            buffer = buffer.slice(fim + 2);
            if (quadro?.evento !== "fatura_paga") continue;
            try {
              const evento = JSON.parse(quadro.dados) as FaturaPagaEvento;
              aplicar(queryClient, evento);
              callback.current?.(evento);
            } catch {
              // a malformed frame is skipped, the stream goes on
            }
          }
        }
        throw new Error("fim do stream");
      } catch {
        if (controle.signal.aborted) return;
        setEstado("reconectando");
        timer = setTimeout(conectar, espera);
        espera = Math.min(espera * 2, 30_000);
      }
    };

    void conectar();
    return () => {
      controle.abort();
      clearTimeout(timer);
    };
  }, [queryClient]);

  return estado;
}
