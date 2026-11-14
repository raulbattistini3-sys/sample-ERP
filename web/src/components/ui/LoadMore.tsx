import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./Button";

type LoadMoreProps = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
  // with a button the next page loads only on click ("Carregar mais 10"); without, as the end scrolls into view
  // total unknown (e.g. Stripe search doesn't count): "Mostrando 40" and "Carregar mais 20"
  botao?: { quantidade: number; carregados: number; total?: number };
};

const numero = new Intl.NumberFormat("pt-BR");

// sits under a list and loads the next rows as it scrolls into view (or on a click, with `botao`); a
// failure waits for a click
export function LoadMore({ hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, botao }: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const armed = !botao && hasNextPage && !isFetchingNextPage && !isFetchNextPageError;

  useEffect(() => {
    if (!armed || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && fetchNextPage(), { rootMargin: "200px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [armed, fetchNextPage]);

  if (botao) {
    return (
      <div className="flex flex-col items-center gap-1 py-4">
        <p className="text-xs text-muted" aria-live="polite">
          Mostrando {numero.format(botao.carregados)}
          {botao.total !== undefined && ` de ${numero.format(botao.total)}`}
        </p>
        {hasNextPage && (
          <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando...
              </>
            ) : isFetchNextPageError ? (
              "Tentar novamente"
            ) : (
              `Carregar mais ${numero.format(botao.total === undefined ? botao.quantidade : Math.min(botao.quantidade, botao.total - botao.carregados))}`
            )}
          </Button>
        )}
      </div>
    );
  }

  if (!hasNextPage) return null;
  return (
    <div ref={sentinel} className="flex min-h-10 items-center justify-center py-4">
      {isFetchingNextPage && <Loader2 className="h-5 w-5 animate-spin text-muted" aria-label="Carregando mais" />}
      {isFetchNextPageError && (
        <Button variant="ghost" onClick={() => fetchNextPage()}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
