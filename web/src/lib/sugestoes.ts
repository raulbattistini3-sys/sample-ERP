import { useMemo, useSyncExternalStore } from "react";

// Values typed before in a field (Cargo, Cidade...), remembered in this browser and offered again on any
// page with the same field, through a <datalist>. Per browser, not shared: a convenience, never data the
// ERP relies on, so a blocked or cleared localStorage just means no suggestions.

const PREFIXO = "erp:sugestoes:";
const MAXIMO = 30;
const ouvintes = new Set<() => void>();

const ler = (campo: string): string[] => {
  try {
    const salvo = JSON.parse(localStorage.getItem(PREFIXO + campo) ?? "[]");
    return Array.isArray(salvo) ? salvo.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

// the most recent first; the same value in another case counts once
export function lembrar(campo: string, ...valores: (string | null | undefined)[]) {
  const novos = valores.map((v) => v?.trim()).filter((v): v is string => !!v);
  if (novos.length === 0) return;
  const chave = (v: string) => v.toLocaleLowerCase("pt-BR");
  const vistos = new Set(novos.map(chave));
  const lista = [...novos, ...ler(campo).filter((v) => !vistos.has(chave(v)))].slice(0, MAXIMO);
  try {
    localStorage.setItem(PREFIXO + campo, JSON.stringify(lista));
  } catch {
    return;
  }
  cache.delete(campo);
  ouvintes.forEach((ouvir) => ouvir());
}

const cache = new Map<string, string[]>();
const instantaneo = (campo: string) => {
  if (!cache.has(campo)) cache.set(campo, ler(campo));
  return cache.get(campo)!;
};

const assinar = (ouvir: () => void) => {
  ouvintes.add(ouvir);
  const outraAba = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIXO)) {
      cache.clear();
      ouvir();
    }
  };
  window.addEventListener("storage", outraAba);
  return () => {
    ouvintes.delete(ouvir);
    window.removeEventListener("storage", outraAba);
  };
};

// what was typed before, then `extras` (e.g. the values already on screen), without repeats
export function useSugestoes(campo: string, extras: (string | null | undefined)[] = []): string[] {
  const lembradas = useSyncExternalStore(assinar, () => instantaneo(campo));
  const chaveExtras = extras.join("\u0000");
  return useMemo(() => {
    const vistos = new Set<string>();
    return [...lembradas, ...chaveExtras.split("\u0000")]
      .map((v) => v.trim())
      .filter((v) => {
        const chave = v.toLocaleLowerCase("pt-BR");
        if (!v || vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      })
      .slice(0, 50);
  }, [lembradas, chaveExtras]);
}
