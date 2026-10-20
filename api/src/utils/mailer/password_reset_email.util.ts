import { MailMessage } from "../../interfaces/mailer_interfaces/mailer.interface";

const escapeHtml = (value: string) =>
   value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export const passwordResetEmail = (
   to: string,
   nome: string,
   link: string,
   ttlMinutes: number,
): MailMessage => ({
   to,
   subject: "Redefinição de senha — ERP Estoque",
   text: [
      `Olá, ${nome}.`,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta no ERP Estoque.",
      `Use o link abaixo em até ${ttlMinutes} minutos (ele só pode ser usado uma vez):`,
      link,
      "",
      "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
   ].join("\n"),
   html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1f2937">
  <h2 style="font-size:18px;margin:0 0 16px">Redefinição de senha</h2>
  <p>Olá, ${escapeHtml(nome)}.</p>
  <p>Recebemos um pedido para redefinir a senha da sua conta no ERP Estoque.</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(link)}" style="background:#0f766e;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Redefinir senha</a>
  </p>
  <p style="font-size:13px;color:#6b7280">O link expira em ${ttlMinutes} minutos e só pode ser usado uma vez.
  Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
</div>`,
});
