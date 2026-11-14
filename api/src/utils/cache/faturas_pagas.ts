import { EventEmitter } from "node:events";
import EscritasRecentes from "./escritas_recentes";

// A paid invoice as the billing webhook reports it (Stripe invoice.paid → billing → POST /internal/billing/events).
export type FaturaPagaEvento = {
  faturaId: string;
  numero: string | null;
  valorCentavos: number;
  email: string;
  nome: string | null;
  url: string | null;
  pagaEm: string;
};

// The invoice lists read Stripe's search index, which runs about a minute behind: an invoice paid just now
// still comes back "open" ("Em aberto"). Payments the webhook reported in the last 30 minutes are kept here
// and laid over those lists, and every open Cobranças page hears about them at once (GET /cobrancas/eventos).
// In memory, per API process: with several API instances, only the one that got the webhook knows; the
// others catch up when Stripe's index does.
class FaturasPagas {
  private readonly recentes = new EscritasRecentes<FaturaPagaEvento>(30 * 60_000, 1000);
  private readonly emissor = new EventEmitter();

  constructor() {
    // one listener per open page; the default limit of 10 would warn
    this.emissor.setMaxListeners(0);
  }

  registrar(fatura: FaturaPagaEvento) {
    const repetida = this.recentes.ler(fatura.faturaId) !== undefined;
    this.recentes.gravar(fatura.faturaId, fatura);
    // billing delivers at least once: a repeated delivery isn't announced twice
    if (!repetida) this.emissor.emit("paga", fatura);
  }

  ler(faturaId: string): FaturaPagaEvento | undefined {
    return this.recentes.ler(faturaId);
  }

  // newest first
  todas(): FaturaPagaEvento[] {
    return this.recentes.todos();
  }

  // returns the function that stops listening
  ouvir(fn: (fatura: FaturaPagaEvento) => void): () => void {
    this.emissor.on("paga", fn);
    return () => this.emissor.off("paga", fn);
  }
}

export const faturasPagas = new FaturasPagas();
