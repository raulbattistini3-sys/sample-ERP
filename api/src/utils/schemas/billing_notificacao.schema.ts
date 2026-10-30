import { z } from "zod";

// what the billing service sends for each Stripe event worth telling the ERP about
export const BillingNotificacaoSchema = z.object({
  eventId: z.string().min(1),
  tipo: z.enum(["fatura_paga", "fatura_falhou"]),
  faturaId: z.string().min(1),
  numero: z.string().nullable(),
  valorCentavos: z.number().int().nonnegative(),
  moeda: z.string().length(3),
  email: z.string().email(),
  nome: z.string().nullable(),
  url: z.string().url().startsWith("https://").nullable(),
});

export type BillingNotificacao = z.infer<typeof BillingNotificacaoSchema>;
