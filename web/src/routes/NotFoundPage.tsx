import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "../components/ui/Button";
import { resolveAliasedPath, suggestPath } from "../lib/route-aliases";

// catch-all route: pt-BR/en aliases are redirected to the canonical url, anything else gets the 404
export function NotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const aliased = resolveAliasedPath(location.pathname);
  if (aliased !== null) {
    return <Navigate to={{ pathname: aliased, search: location.search, hash: location.hash }} replace />;
  }

  const suggestion = suggestPath(location.pathname);

  return (
    <main className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-14 items-center gap-2 border-b border-border bg-surface px-4">
        <div className="h-6 w-6 rounded-sm bg-accent" aria-hidden="true" />
        <Link to="/" className="text-sm font-semibold text-ink">
          ERP Estoque
        </Link>
      </header>

      <section className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-xl text-center">
          <p className="text-8xl font-bold tracking-tight text-accent sm:text-9xl" aria-hidden="true">
            404
          </p>
          <h1 className="mt-4 text-2xl font-semibold text-ink sm:text-3xl">Página não encontrada</h1>
          <p className="mt-3 text-sm text-muted sm:text-base">
            Ops! O endereço que você tentou acessar não existe, foi removido ou está temporariamente
            indisponível.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-muted">{location.pathname}</p>

          {suggestion && (
            <p className="mt-6 text-sm text-ink">
              Você quis dizer{" "}
              <Link to={suggestion} className="font-medium text-accent hover:underline">
                {suggestion}
              </Link>
              ?
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Voltar
            </Button>
            <Button onClick={() => navigate("/")}>
              <Home className="h-4 w-4" aria-hidden="true" />
              Ir para a página inicial
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
