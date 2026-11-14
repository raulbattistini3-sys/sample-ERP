const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_COPIAS = 10;

// "a@x.com; b@y.com, c@z.com" → ["a@x.com", "b@y.com", "c@z.com"] (lowercased, no repeats)
export const listaDeEmails = (texto: string) => [
  ...new Set(
    texto
      .split(/[;,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
];

// the same rules as the API's listaDeEmails; null when fine
export const erroDaLista = (texto: string) => {
  const lista = listaDeEmails(texto);
  const invalidos = lista.filter((e) => !EMAIL.test(e));
  if (invalidos.length) return `E-mail inválido: ${invalidos.join(", ")}.`;
  if (lista.length > MAX_COPIAS) return `No máximo ${MAX_COPIAS} endereços.`;
  return null;
};
