import { useState } from "react";

// the page sizes a list offers ("Mostrar 10 / 20 / 50 / 100 por vez"); 100 is the API's maximum
export const OPCOES_POR_PAGINA = [10, 20, 50, 100] as const;

const ler = (chave: string, padrao: number) => {
  try {
    const n = Number(localStorage.getItem(chave));
    return (OPCOES_POR_PAGINA as readonly number[]).includes(n) ? n : padrao;
  } catch {
    return padrao;
  }
};

// the page size of one list, kept in localStorage (a private window just starts at the default)
export function usePorPagina(lista: string, padrao: number = OPCOES_POR_PAGINA[0]) {
  const chave = `erp:por-pagina:${lista}`;
  const [valor, setValor] = useState(() => ler(chave, padrao));
  const mudar = (n: number) => {
    setValor(n);
    try {
      localStorage.setItem(chave, String(n));
    } catch {
      // storage blocked: the choice lasts until the page reloads
    }
  };
  return [valor, mudar] as const;
}
