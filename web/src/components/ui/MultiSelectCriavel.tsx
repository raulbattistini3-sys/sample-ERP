import { KeyboardEvent, useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

type Props = {
  id: string;
  // what one item is called, for the messages: "cargo"
  item: string;
  valores: string[];
  onChange: (valores: string[]) => void;
  opcoes: string[];
  max?: number;
  // the items are saved joined by ", ": this caps that text (HubSpot's property length, say)
  maxCaracteres?: number;
  invalid?: boolean;
  describedBy?: string;
};


const normal = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();

// Several values picked from a list, like a skills field: each choice becomes a chip, the list filters as
// you type (accents and case ignored), Backspace on an empty field removes the last chip. A value that isn't
// in the list can be added with Enter, after a confirmation, so a typo doesn't become an option by accident.
export function MultiSelectCriavel({ id, item, valores, onChange, opcoes, max = 5, maxCaracteres = 150, invalid, describedBy }: Props) {
  const lista = useId();
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const escolhidos = new Set(valores.map(normal));
  const busca = normal(texto);
  const filtradas = opcoes.filter((o) => !escolhidos.has(normal(o)) && (!busca || normal(o).includes(busca))).slice(0, 8);
  const limpo = texto.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const existe = opcoes.some((o) => normal(o) === busca) || escolhidos.has(busca);
  const itens: { valor: string; novo?: boolean }[] = [...filtradas.map((valor) => ({ valor })), ...(limpo && !existe ? [{ valor: limpo, novo: true }] : [])];
  const cheio = valores.length >= max;

  const adicionar = (valor: string) => {
    setConfirmando(null);
    setTexto("");
    setAtivo(0);
    if (escolhidos.has(normal(valor))) return;
    if (cheio) return setAviso(`No máximo ${max}.`);
    if ([...valores, valor].join(", ").length > maxCaracteres) return setAviso(`Os ${item}s juntos passam de ${maxCaracteres} caracteres.`);
    setAviso(null);
    onChange([...valores, valor]);
    campo.current?.focus();
  };
  const remover = (valor: string) => {
    setAviso(null);
    onChange(valores.filter((v) => v !== valor));
    campo.current?.focus();
  };
  const escolher = (opcao: { valor: string; novo?: boolean }) => (opcao.novo ? setConfirmando(opcao.valor) : adicionar(opcao.valor));

  const teclas = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !texto && valores.length > 0) {
      remover(valores[valores.length - 1]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (itens.length === 0) return;
      event.preventDefault();
      setAberto(true);
      setAtivo((a) => (a + (event.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length);
    } else if (event.key === "Enter") {
      // never submits the form: Enter picks the highlighted option, or asks to add what was typed
      event.preventDefault();
      if (confirmando) return adicionar(confirmando);
      const opcao = aberto ? itens[Math.min(ativo, itens.length - 1)] : undefined;
      if (opcao) escolher(opcao);
      else if (limpo) escolher(existe ? { valor: opcoes.find((o) => normal(o) === busca) ?? limpo } : { valor: limpo, novo: true });
    } else if (event.key === "Escape" && (aberto || confirmando)) {
      event.stopPropagation();
      setAberto(false);
      setConfirmando(null);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent",
          invalid ? "border-red-500" : "border-border",
        )}
        onClick={() => campo.current?.focus()}
      >
        {valores.map((valor) => (
          <span key={valor} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm text-ink">
            {valor}
            <button type="button" aria-label={`Remover ${valor}`} onClick={() => remover(valor)} className="rounded-full text-muted hover:text-ink">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={campo}
          id={id}
          role="combobox"
          aria-expanded={aberto && itens.length > 0}
          aria-controls={lista}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          aria-activedescendant={aberto && itens.length > 0 ? `${lista}-${Math.min(ativo, itens.length - 1)}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={cheio && !texto}
          placeholder={cheio ? `Máximo de ${max}` : valores.length ? "Adicionar outro" : `Escolha ou digite um ${item}`}
          value={texto}
          maxLength={80}
          onChange={(e) => {
            setTexto(e.target.value);
            setConfirmando(null);
            setAberto(true);
            setAtivo(0);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => setAberto(false)}
          onKeyDown={teclas}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>

      {confirmando && (
        <div role="alertdialog" aria-label={`Adicionar ${item}`} className="mt-2 rounded-md border border-accent/40 bg-accent-soft/40 p-3 text-sm">
          <p className="text-ink">
            Adicionar o {item} <strong>"{confirmando}"</strong>? Ele não está na lista e passa a ser sugerido neste navegador.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={() => adicionar(confirmando)}>
              Adicionar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmando(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {aviso && <p className="mt-1 text-xs text-red-700">{aviso}</p>}

      {aberto && !confirmando && itens.length > 0 && (
        <ul id={lista} role="listbox" aria-multiselectable="true" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {itens.map((opcao, i) => (
            <li
              key={(opcao.novo ? "+" : "") + opcao.valor}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === ativo}
              // mousedown, not click: the input's blur would close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(opcao);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-ink", i === ativo && "bg-canvas")}
            >
              {opcao.novo ? (
                <>
                  <Plus className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> Adicionar "{opcao.valor}" (Enter)
                </>
              ) : (
                opcao.valor
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
