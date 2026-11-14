import { useSugestoes } from "../../lib/sugestoes";

// The <datalist> an Input points at with list={id}: the values typed before in `campo` (on this or any
// other page), plus `extras`. Saving the form should call lembrar(campo, value).
export function Sugestoes({ id, campo, extras }: { id: string; campo: string; extras?: (string | null | undefined)[] }) {
  const valores = useSugestoes(campo, extras);
  return (
    <datalist id={id}>
      {valores.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}
