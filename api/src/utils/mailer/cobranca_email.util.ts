import { MailMessage } from "../../interfaces/mailer_interfaces/mailer.interface";
import { escapeHtml } from "./password_reset_email.util";

// The cobrança e-mails, in the same layout as the billing ones (billing_email.util.ts): one to each client
// with its payment link, one to whoever issued them with the outcome of every client.

export const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");

const BOTAO = "background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block";
const CAIXA = "font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937";

type ParaCliente = {
  email: string;
  nome: string;
  descricao: string;
  valorCentavos: number;
  vencimento: string | null;
  numero: string | null;
  url: string;
  emissor: string;
};

export const cobrancaClienteEmail = (c: ParaCliente): MailMessage => {
  const fatura = c.numero ? `a fatura ${c.numero}` : "uma fatura";
  const linhas = [
    `Olá, ${c.nome}.`,
    "",
    `${c.emissor} emitiu ${fatura} para você: ${c.descricao}.`,
    `Valor: ${reais(c.valorCentavos)} · vencimento em ${dia(c.vencimento)}.`,
    "",
    `Pagar: ${c.url}`,
  ];
  return {
    to: c.email,
    subject: `Cobrança de ${reais(c.valorCentavos)}: ${c.descricao}`,
    text: linhas.join("\n"),
    html: `<div style="${CAIXA}">
  <h2 style="font-size:18px;margin:0 0 16px">Você tem uma cobrança</h2>
  <p>${escapeHtml(`Olá, ${c.nome}.`)}</p>
  <p>${escapeHtml(`${c.emissor} emitiu ${fatura} para você: ${c.descricao}.`)}</p>
  <p><strong>${escapeHtml(reais(c.valorCentavos))}</strong> · vencimento em ${escapeHtml(dia(c.vencimento))}</p>
  <p style="margin:24px 0"><a href="${escapeHtml(c.url)}" style="${BOTAO}">Ver e pagar</a></p>
</div>`,
  };
};

export type LinhaResumo = {
  nome: string;
  email: string | null;
  ok: boolean;
  numero: string | null;
  url: string | null;
  erro: string | null;
  emailEnviado: boolean;
};

export const cobrancaEmissorEmail = (emissor: { nome: string; email: string }, descricao: string, valorCentavos: number, linhas: LinhaResumo[]): MailMessage => {
  const emitidas = linhas.filter((l) => l.ok).length;
  const situacao = (l: LinhaResumo) =>
    l.ok ? `fatura ${l.numero ?? ""}${l.emailEnviado ? ", e-mail enviado" : ", e-mail não enviado"}` : `não emitida: ${l.erro ?? "erro"}`;
  return {
    to: emissor.email,
    subject: `Cobranças emitidas: ${emitidas} de ${linhas.length} (${descricao})`,
    text: [
      `Olá, ${emissor.nome}.`,
      "",
      `Você emitiu "${descricao}" de ${reais(valorCentavos)} para ${linhas.length} cliente(s):`,
      ...linhas.map((l) => `- ${l.nome} <${l.email ?? "sem e-mail"}>: ${situacao(l)}${l.url ? ` (${l.url})` : ""}`),
    ].join("\n"),
    html: `<div style="${CAIXA}">
  <h2 style="font-size:18px;margin:0 0 16px">Cobranças emitidas: ${emitidas} de ${linhas.length}</h2>
  <p>${escapeHtml(`Olá, ${emissor.nome}. Você emitiu "${descricao}" de ${reais(valorCentavos)}:`)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${linhas
      .map(
        (l) => `<tr style="border-top:1px solid #e5e7eb">
      <td style="padding:8px 4px">${escapeHtml(l.nome)}<br><span style="color:#6b7280">${escapeHtml(l.email ?? "sem e-mail")}</span></td>
      <td style="padding:8px 4px;text-align:right">${l.url ? `<a href="${escapeHtml(l.url)}">${escapeHtml(situacao(l))}</a>` : escapeHtml(situacao(l))}</td>
    </tr>`,
      )
      .join("")}
  </table>
</div>`,
  };
};
