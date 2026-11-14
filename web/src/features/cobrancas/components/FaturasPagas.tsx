import { useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ErrorAlert, FormCard, LoadingState } from "../../../components/ui/PageState";
import { LoadMore } from "../../../components/ui/LoadMore";
import { PorPagina } from "../../../components/ui/PorPagina";
import { usePorPagina } from "../../../hooks/usePorPagina";
import { getApiErrorMessage } from "../../../lib/api-client";
import { csvNumber, downloadTextFile, toCsv } from "../../../lib/csv";
import { formatCurrency, formatDate } from "../../../lib/form";
import { FaturaRecente, getCobrancasPagas } from "../api/cobrancas.api";
import { useCobrancasPagas } from "../hooks/useCobrancas";

const numero = new Intl.NumberFormat("pt-BR");
// the spreadsheet reads every paid invoice, 100 per request; past this it stops and says so
const MAX_PLANILHA = 10_000;

const dataHora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

const linhaDaPlanilha = (f: FaturaRecente) => [
  f.numero ?? f.id,
  f.clienteNome ?? "",
  f.clienteEmail ?? "",
  f.descricao ?? "",
  csvNumber(f.valorCentavos / 100),
  csvNumber(f.pagoCentavos / 100),
  dataHora(f.criadaEm),
  f.vencimento ? formatDate(f.vencimento) : "",
  dataHora(f.pagaEm),
  f.emissor ?? "",
  f.url ?? "",
];

// "Pagas": the last invoices paid, newest first, N at a time, and the whole list as a spreadsheet (.csv)
export function FaturasPagas() {
  const [porPagina, setPorPagina] = usePorPagina("cobrancas-pagas", 20);
  const pagas = useCobrancasPagas(porPagina);
  const [baixando, setBaixando] = useState(false);
  const [erroPlanilha, setErroPlanilha] = useState<string | null>(null);
  const [cortada, setCortada] = useState(false);

  const faturas = pagas.data?.pages.flatMap((p) => p.faturas) ?? [];

  const baixar = async () => {
    setBaixando(true);
    setErroPlanilha(null);
    setCortada(false);
    try {
      const todas: FaturaRecente[] = [];
      const vistas = new Set<string>();
      let pagina: string | null = null;
      do {
        const lida = await getCobrancasPagas(pagina, 100);
        for (const f of lida.faturas) {
          if (!vistas.has(f.id)) {
            vistas.add(f.id);
            todas.push(f);
          }
        }
        pagina = lida.proxima;
      } while (pagina && todas.length < MAX_PLANILHA);
      setCortada(!!pagina);
      downloadTextFile(
        `faturas-pagas-${new Date().toISOString().slice(0, 10)}.csv`,
        toCsv([
          [
            "Fatura",
            "Cliente",
            "E-mail",
            "Descrição",
            "Valor (R$)",
            "Pago (R$)",
            "Emitida em",
            "Vencimento",
            "Paga em",
            "Emitida por",
            "Link",
          ],
          ...todas.map(linhaDaPlanilha),
        ]),
      );
    } catch (e) {
      setErroPlanilha(getApiErrorMessage(e, "Não foi possível montar a planilha."));
    } finally {
      setBaixando(false);
    }
  };

  return (
    <FormCard className="max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Faturas pagas</h3>
          <p className="mt-1 text-sm text-muted">
            As últimas pagas primeiro. Um pagamento aparece aqui assim que o Stripe avisa, sem recarregar a página.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PorPagina id="pagas-por-pagina" valor={porPagina} onChange={setPorPagina} />
          <Button type="button" size="sm" variant="secondary" onClick={baixar} disabled={baixando || !faturas.length}>
            {baixando ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {baixando ? "Montando planilha…" : "Baixar planilha (.csv)"}
          </Button>
        </div>
      </div>
      {erroPlanilha && <ErrorAlert className="mt-3" message={erroPlanilha} />}
      {cortada && (
        <p className="mt-3 text-sm text-amber-700">
          A planilha traz as {numero.format(MAX_PLANILHA)} faturas pagas mais recentes. Para o histórico completo, exporte pelo
          painel do Stripe.
        </p>
      )}

      {pagas.isLoading ? (
        <LoadingState />
      ) : pagas.error ? (
        <ErrorAlert
          className="mt-3"
          message={getApiErrorMessage(pagas.error, "Não foi possível ler as faturas pagas do Stripe.")}
        />
      ) : !faturas.length ? (
        <p className="mt-3 text-sm text-muted">Nenhuma fatura paga ainda.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Fatura</th>
                  <th className="py-2 pr-3 font-medium">Cliente</th>
                  <th className="py-2 pr-3 font-medium">Valor pago</th>
                  <th className="py-2 font-medium">Paga em</th>
                </tr>
              </thead>
              <tbody>
                {faturas.map((f) => (
                  <tr key={f.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      {f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          {f.numero ?? f.id}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        (f.numero ?? f.id)
                      )}
                      {f.descricao && <span className="block text-xs text-muted">{f.descricao}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {f.clienteNome ?? "—"}
                      <span className="block text-xs text-muted">{f.clienteEmail}</span>
                    </td>
                    <td className="py-2 pr-3">{formatCurrency(f.pagoCentavos / 100)}</td>
                    <td className="py-2">{f.pagaEm ? dataHora(f.pagaEm) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore
            hasNextPage={pagas.hasNextPage}
            isFetchingNextPage={pagas.isFetchingNextPage}
            isFetchNextPageError={pagas.isFetchNextPageError}
            fetchNextPage={pagas.fetchNextPage}
            botao={{ quantidade: porPagina, carregados: faturas.length }}
          />
        </>
      )}
    </FormCard>
  );
}
