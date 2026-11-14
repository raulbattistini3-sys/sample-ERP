// "A, B" ⇄ ["A", "B"]: how a list of values (a client's cargos) is kept in a single text property
export const separarItens = (texto: string | null | undefined) =>
  (texto ?? "")
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);

export const juntarItens = (valores: string[]) => valores.join(", ");