import { KeyboardEvent, useId, useState } from "react";
import { Building2, Check, Plus } from "lucide-react";
import { Input } from "../../../components/ui/Field";
import { getApiErrorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { useDebounced } from "../../../hooks/useDebounced";
import { useEmpresas, useSalvarEmpresa } from "../hooks/useClientes";

export type EmpresaEscolhida = { id: string | null; nome: string };

type Props = {
  id: string;
  value: EmpresaEscolhida;
  onChange: (empresa: EmpresaEscolhida) => void;
  invalid?: boolean;
};

// HubSpot's search only starts at this many letters: fewer would match half the portal
const MIN_BUSCA_EMPRESA = 3;

const SEM_DADOS = { dominio: "", setor: "", telefone: "", cidade: "", estado: "", pais: "", site: "", descricao: "", emailSac: "", responsavelId: "" };

// A combobox over HubSpot's companies. Picking one links the client to it; typing a name nobody has offers
// "Criar empresa", which creates it in HubSpot right then: the field only ever holds a company that exists.
export function EmpresaPicker({ id, value, onChange, invalid }: Props) {
  const lista = useId();
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const criar = useSalvarEmpresa();
  const busca = useDebounced(value.nome.trim(), 300);
  const empresas = useEmpresas(busca, false, aberto && busca.length >= MIN_BUSCA_EMPRESA, 10);

  const nome = value.nome.trim();
  const curta = nome.length < MIN_BUSCA_EMPRESA;
  const achadas = curta ? [] : (empresas.data?.pages.flatMap((p) => p.data) ?? []).slice(0, 8);
  const exata = achadas.some((e) => e.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"));
  const opcoes: (EmpresaEscolhida & { nova?: boolean; detalhe?: string })[] = [
    ...achadas.map((e) => ({ id: e.id, nome: e.nome, detalhe: [e.dominio, `${e.total_contatos} contato(s)`].filter(Boolean).join(" · ") })),
    ...(nome && !exata ? [{ id: null, nome, nova: true }] : []),
  ];

  const escolher = (opcao: EmpresaEscolhida & { nova?: boolean }) => {
    setAberto(false);
    if (!opcao.nova) return onChange({ id: opcao.id, nome: opcao.nome });
    criar.mutate(
      { id: null, form: { ...SEM_DADOS, nome: opcao.nome } },
      { onSuccess: (salva) => onChange({ id: salva.data.id, nome: salva.data.nome }) },
    );
  };

  const teclas = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!aberto || opcoes.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setAtivo((a) => (a + (event.key === "ArrowDown" ? 1 : opcoes.length - 1)) % opcoes.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      escolher(opcoes[Math.min(ativo, opcoes.length - 1)]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setAberto(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={aberto && opcoes.length > 0}
        aria-controls={lista}
        aria-autocomplete="list"
        aria-activedescendant={aberto && opcoes.length > 0 ? `${lista}-${Math.min(ativo, opcoes.length - 1)}` : undefined}
        autoComplete="off"
        maxLength={150}
        placeholder="Digite 3 ou mais letras para buscar"
        value={value.nome}
        invalid={invalid || !!criar.error}
        disabled={criar.isPending}
        className={value.id ? "pr-9" : undefined}
        onChange={(e) => {
          // typing again unpicks: nothing counts until a company is picked from the list
          criar.reset();
          onChange({ id: null, nome: e.target.value });
          setAberto(true);
          setAtivo(0);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={teclas}
      />
      {value.id && <Check className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-emerald-600" aria-label="Empresa escolhida" />}
      {criar.isPending && <p className="mt-1 text-xs text-muted">Criando a empresa no HubSpot...</p>}
      {criar.error && <p className="mt-1 text-xs text-red-700">{getApiErrorMessage(criar.error, "Não foi possível criar a empresa.")}</p>}
      {aberto && nome.length > 0 && (
        <ul
          id={lista}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {curta && (
            <li className="px-3 py-2 text-xs text-muted" aria-disabled="true">
              Digite 3 ou mais letras para buscar nas empresas do HubSpot.
            </li>
          )}
          {!curta && empresas.isFetching && achadas.length === 0 && <li className="px-3 py-2 text-sm text-muted">Buscando...</li>}
          {opcoes.map((opcao, i) => (
            <li
              key={opcao.id ?? "nova"}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === ativo}
              // mousedown, not click: the input's blur would close the list first
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(opcao);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-sm", i === ativo && "bg-canvas")}
            >
              {opcao.nova ? (
                <Plus className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              ) : (
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              )}
              <span>
                <span className="text-ink">{opcao.nova ? `Criar empresa "${opcao.nome}"` : opcao.nome}</span>
                {opcao.detalhe && <span className="block text-xs text-muted">{opcao.detalhe}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
