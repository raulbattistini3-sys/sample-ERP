import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, UserRound } from "lucide-react";
import { LoadMore } from "../../../components/ui/LoadMore";
import { ErrorAlert } from "../../../components/ui/PageState";
import { PorPagina } from "../../../components/ui/PorPagina";
import { usePorPagina } from "../../../hooks/usePorPagina";
import { getApiErrorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { EmpresaNoFunil, Estagio, ESTAGIO_LABEL, ESTAGIOS, TipoAtividade } from "../api/atividades.api";
import { useColunaDoFunil, useMoverEmpresa, useResponsaveis } from "../hooks/useAtividades";
import { useSetorLabel } from "../hooks/useClientes";
import { AlvoDaAtividade } from "./AtividadeModal";
import { AtalhosDeAtividade } from "./ClienteAcoes";

type AoAtividade = (alvo: AlvoDaAtividade, tipo: TipoAtividade) => void;
const ARRASTO = "application/x-sample-erp-empresa";

// Funil: the companies by HubSpot lifecycle stage, one column per stage, like a Jira board. The board
// scrolls sideways (scrollbar, Shift + mouse wheel, or the arrow keys once it has focus). Dragging a card,
// or the "Mover para" menu on it, changes the stage in HubSpot. Paying an invoice moves it to "Cliente".
export function FunilBoard({ busca, onAtividade }: { busca: string; onAtividade: AoAtividade }) {
  const quadro = useRef<HTMLDivElement>(null);
  const mover = useMoverEmpresa();
  const responsaveis = useResponsaveis();
  const nomes = useMemo(() => new Map((responsaveis.data ?? []).map((r) => [r.id, r.nome])), [responsaveis.data]);
  // cards per column, loaded N at a time like Empresas ("Mostrar [10] por vez" + "Carregar mais 10")
  const [porPagina, setPorPagina] = usePorPagina("clientes-funil", 10);

  // Shift + wheel scrolls sideways in every browser (Chrome does it alone, not all others). Native listener:
  // React's onWheel is passive and can't stop the page from scrolling too.
  useEffect(() => {
    const el = quadro.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return;
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const moverPara = (empresa: EmpresaNoFunil, para: Estagio) => {
    if (empresa.estagio !== para) mover.mutate({ id: empresa.id, de: empresa.estagio, para });
  };

  return (
    <div>
      {mover.error && <ErrorAlert className="mb-3" message={getApiErrorMessage(mover.error, "Não foi possível mudar a etapa no HubSpot.")} />}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Arraste os cards entre as etapas. Shift + roda do mouse rola o quadro para os lados.</p>
        <PorPagina id="funil-por-pagina" valor={porPagina} onChange={setPorPagina} />
      </div>
      <div
        ref={quadro}
        tabIndex={0}
        role="region"
        aria-label="Funil de empresas"
        className="flex snap-x gap-3 overflow-x-auto pb-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ESTAGIOS.map((estagio) => (
          <Coluna key={estagio} estagio={estagio} busca={busca} porPagina={porPagina} nomes={nomes} onMover={moverPara} onAtividade={onAtividade} />
        ))}
      </div>
    </div>
  );
}

type ColunaProps = {
  estagio: Estagio;
  busca: string;
  porPagina: number;
  nomes: Map<string, string>;
  onMover: (empresa: EmpresaNoFunil, para: Estagio) => void;
  onAtividade: AoAtividade;
};

function Coluna({ estagio, busca, porPagina, nomes, onMover, onAtividade }: ColunaProps) {
  const coluna = useColunaDoFunil(estagio, busca, porPagina);
  const [alvo, setAlvo] = useState(false);
  const empresas = coluna.data?.pages.flatMap((p) => p.data) ?? [];
  const total = coluna.data?.pages[0]?.total ?? 0;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setAlvo(false);
    const dados = event.dataTransfer.getData(ARRASTO);
    if (!dados) return;
    onMover(JSON.parse(dados) as EmpresaNoFunil, estagio);
  };

  return (
    <section
      aria-label={ESTAGIO_LABEL[estagio]}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(ARRASTO)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setAlvo(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAlvo(false);
      }}
      onDrop={onDrop}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col rounded-lg border bg-canvas",
        alvo ? "border-accent ring-2 ring-accent/30" : "border-border",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold text-ink">{ESTAGIO_LABEL[estagio]}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{coluna.isLoading ? "…" : total}</span>
      </header>
      <div className="flex max-h-[65vh] min-h-32 flex-col gap-2 overflow-y-auto p-2">
        {coluna.isLoading ? (
          <p className="p-2 text-xs text-muted">Carregando...</p>
        ) : coluna.error ? (
          <p className="p-2 text-xs text-red-700">{getApiErrorMessage(coluna.error, "Erro ao carregar.")}</p>
        ) : empresas.length === 0 ? (
          <p className="p-2 text-xs text-muted">Nenhuma empresa.</p>
        ) : (
          empresas.map((empresa) => (
            <Card key={empresa.id} empresa={empresa} responsavel={empresa.responsavelId ? nomes.get(empresa.responsavelId) : undefined} onMover={onMover} onAtividade={onAtividade} />
          ))
        )}
        {empresas.length > 0 && (
          <LoadMore
            hasNextPage={coluna.hasNextPage}
            isFetchingNextPage={coluna.isFetchingNextPage}
            isFetchNextPageError={coluna.isFetchNextPageError}
            fetchNextPage={coluna.fetchNextPage}
            botao={{ quantidade: porPagina, carregados: empresas.length, total }}
          />
        )}
      </div>
    </section>
  );
}

type CardProps = {
  empresa: EmpresaNoFunil;
  responsavel: string | undefined;
  onMover: (empresa: EmpresaNoFunil, para: Estagio) => void;
  onAtividade: AoAtividade;
};

function Card({ empresa, responsavel, onMover, onAtividade }: CardProps) {
  const lugar = [empresa.cidade, empresa.estado].filter(Boolean).join(" / ");
  const setor = useSetorLabel()(empresa.setor);
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(ARRASTO, JSON.stringify(empresa));
        event.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-md border border-border bg-surface p-2.5 text-sm shadow-sm active:cursor-grabbing"
    >
      <Link to={`/clientes/empresas/${empresa.id}`} className="font-medium text-ink hover:underline">
        {empresa.nome}
      </Link>
      {(empresa.dominio || setor) && <p className="truncate text-xs text-muted">{[empresa.dominio, setor].filter(Boolean).join(" · ")}</p>}
      <div className="mt-1.5 space-y-0.5 text-xs text-muted">
        {lugar && (
          <p className="flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" /> {lugar}
          </p>
        )}
        <p className="flex items-center gap-1">
          <UserRound className="h-3 w-3" aria-hidden="true" /> {responsavel ?? (empresa.responsavelId ? "Responsável no HubSpot" : "Sem responsável")}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className="flex">
          <AtalhosDeAtividade nome={empresa.nome} comEmail={false} onAtividade={(tipo) => onAtividade({ empresaId: empresa.id, nome: empresa.nome }, tipo)} />
        </span>
        <select
          aria-label={`Mover ${empresa.nome} para`}
          value={empresa.estagio}
          onChange={(event) => onMover(empresa, event.target.value as Estagio)}
          className="max-w-32 rounded border border-border bg-surface px-1 py-0.5 text-xs text-ink"
        >
          {ESTAGIOS.map((e) => (
            <option key={e} value={e}>
              {ESTAGIO_LABEL[e]}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}
