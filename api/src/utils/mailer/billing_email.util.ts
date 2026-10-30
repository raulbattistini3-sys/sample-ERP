import { MailMessage } from "../../interfaces/mailer_interfaces/mailer.interface";
import { BillingNotificacao } from "../schemas/billing_notificacao.schema";
import { escapeHtml } from "./password_reset_email.util";

const formatarValor = (centavos: number, moeda: string) =>
   new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda.toUpperCase() }).format(centavos / 100);

const CONTEUDO = {
   fatura_paga: {
      assunto: (fatura: string) => `Pagamento confirmado: ${fatura}`,
      titulo: "Pagamento confirmado",
      texto: (fatura: string, valor: string) => `Recebemos o pagamento de ${valor} da ${fatura}. Obrigado!`,
      acao: "Ver fatura",
   },
   fatura_falhou: {
      assunto: (fatura: string) => `Pagamento não concluído: ${fatura}`,
      titulo: "Pagamento não concluído",
      texto: (fatura: string, valor: string) => `Não conseguimos concluir o pagamento de ${valor} da ${fatura}.`,
      acao: "Pagar fatura",
   },
} as const;

export const billingEmail = ({ tipo, numero, valorCentavos, moeda, email, nome, url }: BillingNotificacao): MailMessage => {
   const conteudo = CONTEUDO[tipo];
   const fatura = numero ? `fatura ${numero}` : "sua fatura";
   const valor = formatarValor(valorCentavos, moeda);
   const saudacao = nome ? `Olá, ${nome}.` : "Olá.";
   const texto = conteudo.texto(fatura, valor);
   return {
      to: email,
      subject: conteudo.assunto(fatura),
      text: [saudacao, "", texto, ...(url ? ["", `${conteudo.acao}: ${url}`] : [])].join("\n"),
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2937">
  <h2 style="font-size:18px;margin:0 0 16px">${conteudo.titulo}</h2>
  <p>${escapeHtml(saudacao)}</p>
  <p>${escapeHtml(texto)}</p>
  ${url ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${conteudo.acao}</a></p>` : ""}
</div>`,
   };
};
