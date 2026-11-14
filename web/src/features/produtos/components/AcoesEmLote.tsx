import { Bookmark, BookmarkX, CircleOff, CircleCheck, Loader2, Star, StarOff, X } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, SuccessAlert } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { AcaoEmLote, Marcacoes, ResultadoEmLote } from "../api/product.api";
import { useProdutoLote } from "../hooks/useProducts";

const FEITO: Record<AcaoEmLote, string> = {
  inativar: "inativado(s)",
  ativar: "reativado(s)",
  favoritar: "adicionado(s) aos favoritos",
  desfavoritar: "removido(s) dos favoritos",
  salvar_depois: "salvo(s) para depois",
  tirar_depois: "removido(s) de \"para depois\"",
};

const mensagem = (r: ResultadoEmLote) => {
  const iguais = r.selecionados - r.alterados;
  return `${r.alterados} produto(s) ${FEITO[r.acao]}.${iguais > 0 ? ` ${iguais} já estava(m) assim.` : ""}`;
};

type Props = {
  selecionados: ReadonlySet<string>;
  marcacoes: Marcacoes | undefined;
  podeReativar: boolean;
  onLimpar: () => void;
};

// The bar over the product list while products are ticked, like an inbox: act on all of them at once.
// Favourites and "para depois" are the user's own; inativar/ativar change the product for everyone.
export function AcoesEmLote({ selecionados, marcacoes, podeReativar, onLimpar }: Props) {
  const lote = useProdutoLote();
  const ids = [...selecionados];
  const todos = (lista: string[] | undefined) => ids.length > 0 && !!lista && ids.every((id) => lista.includes(id));
  const todosFavoritos = todos(marcacoes?.favorito);
  const todosDepois = todos(marcacoes?.depois);

  const executar = (acao: AcaoEmLote) => {
    if (acao === "inativar" && !window.confirm(`Inativar ${ids.length} produto(s)? Eles deixam de aparecer para quem não é administrador.`)) return;
    lote.mutate(
      { acao, ids },
      // after inativar the rows leave the list (for non-admins) or change status; start over
      { onSuccess: () => (acao === "inativar" || acao === "ativar") && onLimpar() },
    );
  };

  if (ids.length === 0) {
    return (
      <>
        {lote.data && <SuccessAlert className="mb-3" message={mensagem(lote.data)} />}
        {lote.error && <ErrorAlert className="mb-3" message={getApiErrorMessage(lote.error, "Não foi possível concluir a ação.")} />}
      </>
    );
  }

  const ocupado = lote.isPending;
  const icone = (Icone: typeof Star, acao: AcaoEmLote) =>
    ocupado && lote.variables?.acao === acao ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icone className="h-4 w-4" aria-hidden="true" />;

  return (
    <div className="sticky top-0 z-10 mb-3 space-y-2">
      <div
        role="toolbar"
        aria-label="Ações para os produtos selecionados"
        className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 shadow-sm"
      >
        <span className="mr-auto text-sm font-medium text-ink" aria-live="polite">
          {ids.length} selecionado(s)
        </span>
        {todosFavoritos ? (
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => executar("desfavoritar")}>
            {icone(StarOff, "desfavoritar")} Tirar dos favoritos
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => executar("favoritar")}>
            {icone(Star, "favoritar")} Favoritar
          </Button>
        )}
        {todosDepois ? (
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => executar("tirar_depois")}>
            {icone(BookmarkX, "tirar_depois")} Tirar de "para depois"
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => executar("salvar_depois")}>
            {icone(Bookmark, "salvar_depois")} Salvar para depois
          </Button>
        )}
        {podeReativar && (
          <Button size="sm" variant="secondary" disabled={ocupado} onClick={() => executar("ativar")}>
            {icone(CircleCheck, "ativar")} Ativar
          </Button>
        )}
        <Button size="sm" variant="danger" disabled={ocupado} onClick={() => executar("inativar")}>
          {icone(CircleOff, "inativar")} Inativar
        </Button>
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={onLimpar} aria-label="Limpar seleção">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {lote.data && !ocupado && <SuccessAlert message={mensagem(lote.data)} />}
      {lote.error && <ErrorAlert message={getApiErrorMessage(lote.error, "Não foi possível concluir a ação.")} />}
    </div>
  );
}
