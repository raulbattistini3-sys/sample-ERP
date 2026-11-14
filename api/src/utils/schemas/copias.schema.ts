import { z } from "zod";

// CC / CCO of an e-mail: up to 10 addresses, lowercased, without repeats
export const listaDeEmails = (rotulo: string) =>
  z
    .array(z.string().trim().toLowerCase().email(`${rotulo}: e-mail inválido.`), { invalid_type_error: `${rotulo}: lista de e-mails inválida.` })
    .max(10, `${rotulo}: no máximo 10 e-mails.`)
    .default([])
    .transform((emails) => [...new Set(emails)]);

// the client is already the recipient: a copy to them is dropped
export const semDestinatario = (lista: string[], destinatario: string) => lista.filter((e) => e !== destinatario.toLowerCase());
