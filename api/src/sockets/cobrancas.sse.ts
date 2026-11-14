import type { Request, Response } from "express";
import { faturasPagas } from "../utils/cache/faturas_pagas";

// GET /cobrancas/eventos: a Server-Sent Events stream (behind requireAdminRole, like the rest of /cobrancas).
// Each invoice the billing webhook reports as paid arrives as
//   event: fatura_paga
//   data: {"faturaId":"in_…","numero":"…","valorCentavos":30000,…}
// and the Cobranças page flips it from "Em aberto" to "Paga" without a reload. The web reads it with fetch
// (EventSource can't send the Authorization header).

// proxies drop a connection that is quiet for a minute or so; a comment line every 25 s keeps it open
const HEARTBEAT_MS = 25_000;
// the browser waits this long before reconnecting after a drop
const RETRY_MS = 5_000;
// a tab holds one stream; a client opening hundreds is a bug or abuse
const MAX_CONEXOES = 500;
let conexoes = 0;

export const eventosDeCobranca = (req: Request, res: Response) => {
  if (conexoes >= MAX_CONEXOES) {
    res.status(503).json({ message: "Muitas conexões de eventos abertas. Tente de novo em instantes." });
    return;
  }
  conexoes += 1;
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx and similar buffer responses by default; this one has to flow as written
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`retry: ${RETRY_MS}\n\n`);

  const parar = faturasPagas.ouvir((fatura) => {
    res.write(`event: fatura_paga\nid: ${fatura.faturaId}\ndata: ${JSON.stringify(fatura)}\n\n`);
  });
  const batida = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  batida.unref();

  let fechado = false;
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    conexoes -= 1;
    clearInterval(batida);
    parar();
  };
  req.on("close", fechar);
  res.on("error", fechar);
};
