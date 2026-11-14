import { OPCOES_POR_PAGINA } from "../../hooks/usePorPagina";

type PorPaginaProps = { id: string; valor: number; onChange: (valor: number) => void };

// "Mostrar [10] por vez", like a store's product grid; pairs with usePorPagina and LoadMore's button
export function PorPagina({ id, valor, onChange }: PorPaginaProps) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
      Mostrar
      <select
        id={id}
        value={valor}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink"
      >
        {OPCOES_POR_PAGINA.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      por vez
    </label>
  );
}
