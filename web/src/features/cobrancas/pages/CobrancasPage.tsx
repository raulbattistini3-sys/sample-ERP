import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, Receipt, Search, X, XCircle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader, SuccessAlert } from "../../../components/ui/PageState";
import { LoadMore } from "../../../components/ui/LoadMore";
import { useDebounced } from "../../../hooks/useDebounced";
import { useUser } from "../../../hooks/useSession";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatCurrency, formatDate } from "../../../lib/form";
import { isAdminRole } from "../../../lib/permissoes";
import { cn } from "../../../lib/cn";
import { Cliente } from "../../clientes/api/clientes.api";
import { useClientes } from "../../clientes/hooks/useClientes";
import { CobrancaEmitida, WhatsappStatus } from "../api/cobrancas.api";
import { useCobrancasRecentes, useEmitirCobranca, useStripeConexao } from "../hooks/useCobrancas";
import { parseReais } from "../utils/valores";
import { PagamentosMensais } from "../components/PagamentosMensais";
import { LinhaDoTempoCard } from "../components/LinhaDoTempoCard";
import { FaturasPagas } from "../components/FaturasPagas";
import { FaturaPagaEvento } from "../api/cobrancas.api";
import { useEventosDeCobranca } from "../hooks/useEventosDeCobranca";
import { CopiasFields } from "../components/CopiasFields";
import { erroDaLista, listaDeEmails } from "../utils/copias";

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Rascunho", className: "bg-canvas text-muted" },
  open: { label: "Em aberto", className: "bg-amber-50 text-amber-700" },
  paid: { label: "Paga", className: "bg-accent-soft text-accent" },
  void: { label: "Cancelada", className: "bg-canvas text-muted" },
  uncollectible: { label: "Incobrável", className: "bg-red-50 text-red-700" },
};

function Resultado({ data }: { data: CobrancaEmitida }) {
  const emitidas = data.resultados.filter((r) => r.ok).length;
  return (
    <div className="mt-4 space-y-2" role="status">
      {emitidas > 0 ? (
        <SuccessAlert message={`${emitidas} de ${data.resultados.length} cobrança(s) emitida(s).`} />
      ) : (
        <ErrorAlert message="Nenhuma cobrança foi emitida." />
      )}
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {data.resultados.map((r) => (
          <li key={r.clienteId} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
            <span className="flex items-start gap-2">
              {r.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-accent" aria-hidden="true" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-red-600" aria-hidden="true" />
              )}
              <span>
                <span className="font-medium text-ink">{r.nome}</span>
                <span className="block text-xs text-muted">{r.email ?? "sem e-mail"}</span>
              </span>
            </span>
            <span className="text-right text-xs">
              {r.ok && r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  Fatura {r.numero}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
              <span className={cn("block", r.erro ? "text-red-700" : "text-muted")}>
                {r.erro ?? (r.emailEnviado ? "E-mail enviado ao cliente" : "")}
              </span>
              {r.ok && <Avisos nota={r.notaNoHubspot} whatsapp={r.whatsapp ?? null} />}
              {r.semCopias && (
                <span className="block text-amber-700">
                  Cc/Cco recusados pelo provedor de e-mail (modo de teste?): foi só para o cliente.
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        {data.emissorNotificado
          ? "Você recebeu o resumo por e-mail."
          : `O resumo não foi enviado a você: ${data.erroEmailEmissor}`}
      </p>
    </div>
  );
}

function Recentes() {
  const { data, isLoading, error } = useCobrancasRecentes();
  return (
    <FormCard className="max-w-4xl">
      <h3 className="text-base font-semibold text-ink">Cobranças recentes</h3>
      <p className="mt-1 text-sm text-muted">As últimas faturas emitidas pelo ERP, direto do Stripe.</p>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorAlert className="mt-3" message={getApiErrorMessage(error, "Não foi possível ler as cobranças do Stripe.")} />
      ) : !data?.length ? (
        <p className="mt-3 text-sm text-muted">Nenhuma cobrança ainda.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-2 pr-3 font-medium">Fatura</th>
                <th className="py-2 pr-3 font-medium">Cliente</th>
                <th className="py-2 pr-3 font-medium">Valor</th>
                <th className="py-2 pr-3 font-medium">Vencimento</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => {
                const status = STATUS[f.status] ?? {
                  label: f.status,
                  className: "bg-canvas text-muted",
                };
                return (
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
                      <span className="block text-xs text-muted">{formatDate(f.criadaEm)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {f.clienteNome ?? "—"}
                      <span className="block text-xs text-muted">{f.clienteEmail}</span>
                    </td>
                    <td className="py-2 pr-3">{formatCurrency(f.valorCentavos / 100)}</td>
                    <td className="py-2 pr-3">{f.vencimento ? formatDate(f.vencimento) : "—"}</td>
                    <td className="py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormCard>
  );
}

// /cobrancas: pick clients from HubSpot (the Clientes data), describe the charge, and issue one Stripe
// invoice per client; each client gets its payment link by e-mail and the issuer gets a summary.
type Visao = "geral" | "pagas";

export const CobrancasPage = () => {
  const user = useUser();
  const stripe = useStripeConexao();
  const emitir = useEmitirCobranca();
  const [visao, setVisao] = useState<Visao>("geral");
  // the billing webhook's payments, live: lists on screen flip to "Paga" as they arrive
  const [pagaAgora, setPagaAgora] = useState<FaturaPagaEvento | null>(null);
  const eventos = useEventosDeCobranca(setPagaAgora);

  const [busca, setBusca] = useState("");
  const termo = useDebounced(busca.trim());
  const clientes = useClientes(termo, true);
  const lista = useMemo(() => clientes.data?.pages.flatMap((p) => p.data) ?? [], [clientes.data]);
  // kept across searches and pages: id → the client as it was when ticked
  const [selecionados, setSelecionados] = useState<Map<string, Cliente>>(new Map());
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimentoDias, setVencimentoDias] = useState("7");
  const [cc, setCc] = useState("");
  const [cco, setCco] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});

  if (!isAdminRole(user?.permissoes)) {
    return <ErrorAlert message="Apenas administradores podem emitir cobranças." />;
  }

  const alternar = (c: Cliente) =>
    setSelecionados((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c);
      return next;
    });

  const visiveisComEmail = lista.filter((c) => c.email);
  const todosVisiveis = visiveisComEmail.length > 0 && visiveisComEmail.every((c) => selecionados.has(c.id));
  const alternarTodos = () =>
    setSelecionados((prev) => {
      const next = new Map(prev);
      visiveisComEmail.forEach((c) => (todosVisiveis ? next.delete(c.id) : next.set(c.id, c)));
      return next;
    });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const e: Record<string, string> = {};
    const v = parseReais(valor);
    if (selecionados.size === 0) e.clientes = "Escolha pelo menos um cliente.";
    if (!descricao.trim()) e.descricao = "Informe a descrição.";
    if (!(v >= 1)) e.valor = "Informe um valor de pelo menos R$ 1,00.";
    const dias = Number(vencimentoDias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 60) e.vencimento = "Entre 1 e 60 dias.";
    const erroCc = erroDaLista(cc);
    const erroCco = erroDaLista(cco);
    if (erroCc) e.cc = erroCc;
    if (erroCco) e.cco = erroCco;
    setErros(e);
    if (Object.keys(e).length) return;
    const nomes = [...selecionados.values()].map((c) => c.nome).join(", ");
    if (!window.confirm(`Emitir ${formatCurrency(v)} para ${selecionados.size} cliente(s): ${nomes}?`)) return;
    emitir.mutate(
      {
        clienteIds: [...selecionados.keys()],
        descricao: descricao.trim(),
        valor: v,
        vencimentoDias: dias,
        cc: listaDeEmails(cc),
        cco: listaDeEmails(cco),
      },
      {
        onSuccess: (data) => data.resultados.every((r) => r.ok) && setSelecionados(new Map()),
      },
    );
  };

  const stripeOk = !!stripe.data?.status?.conectado;

  return (
    <div className="space-y-4">
      <PageHeader title="Cobranças" />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          <Button
            variant={visao === "geral" ? "primary" : "ghost"}
            aria-pressed={visao === "geral"}
            onClick={() => setVisao("geral")}
          >
            Emitir e acompanhar
          </Button>
          <Button
            variant={visao === "pagas" ? "primary" : "ghost"}
            aria-pressed={visao === "pagas"}
            onClick={() => setVisao("pagas")}
          >
            Pagas
          </Button>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-xs text-muted"
          title="Pagamentos chegam pelo webhook do Stripe, sem recarregar"
        >
          <span
            aria-hidden="true"
            className={cn("h-2 w-2 rounded-full", eventos === "ao-vivo" ? "bg-emerald-500" : "bg-amber-400")}
          />
          {eventos === "ao-vivo" ? "Pagamentos ao vivo" : eventos === "conectando" ? "Conectando…" : "Reconectando…"}
        </span>
      </div>
      <div aria-live="polite">
        {pagaAgora && (
          <SuccessAlert
            className="max-w-4xl"
            message={`Pagamento recebido: fatura ${pagaAgora.numero ?? pagaAgora.faturaId} de ${pagaAgora.nome ?? pagaAgora.email}, ${formatCurrency(pagaAgora.valorCentavos / 100)}.`}
          />
        )}
      </div>
      {visao === "pagas" ? (
        <FaturasPagas />
      ) : (
        <>
          {stripe.data && !stripeOk && (
            <ErrorAlert
              className="max-w-4xl"
              message="O Stripe não está conectado, então nenhuma cobrança pode ser emitida agora. Veja o que falta em Integrações."
            />
          )}

          <FormCard className="max-w-4xl">
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-ink">Para quem</h3>
                    <p className="mt-1 text-sm text-muted">
                      Contatos do HubSpot, como em{" "}
                      <Link to="/clientes" className="text-accent hover:underline">
                        Clientes
                      </Link>
                      . Cada um recebe sua fatura por e-mail.
                    </p>
                  </div>
                  <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2">
                    <Search className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                    <input
                      type="search"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar cliente..."
                      aria-label="Buscar cliente"
                      className="w-48 bg-transparent text-sm outline-none placeholder:text-muted"
                    />
                  </label>
                </div>

                {selecionados.size > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Clientes escolhidos">
                    {[...selecionados.values()].map((c) => (
                      <li
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-ink"
                      >
                        {c.nome}
                        <button
                          type="button"
                          onClick={() => alternar(c)}
                          aria-label={`Tirar ${c.nome}`}
                          className="text-muted hover:text-ink"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 max-h-80 overflow-auto rounded-md border border-border">
                  {clientes.isLoading ? (
                    <div className="p-4">
                      <LoadingState />
                    </div>
                  ) : clientes.error ? (
                    <ErrorAlert
                      className="m-3"
                      message={getApiErrorMessage(clientes.error, "Não foi possível ler os clientes do HubSpot.")}
                    />
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface">
                        <tr className="border-b border-border text-left text-muted">
                          <th className="w-10 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={todosVisiveis}
                              onChange={alternarTodos}
                              aria-label="Escolher todos os visíveis"
                              disabled={!visiveisComEmail.length}
                            />
                          </th>
                          <th className="px-3 py-2 font-medium">Nome</th>
                          <th className="px-3 py-2 font-medium">E-mail</th>
                          <th className="px-3 py-2 font-medium">Empresa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map((c) => {
                          const marcado = selecionados.has(c.id);
                          return (
                            <tr
                              key={c.id}
                              onClick={() => c.email && alternar(c)}
                              className={cn(
                                "border-b border-border last:border-0",
                                c.email ? "cursor-pointer hover:bg-canvas" : "opacity-60",
                                marcado && "bg-accent-soft/40",
                              )}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  disabled={!c.email}
                                  onChange={() => alternar(c)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Escolher ${c.nome}`}
                                />
                              </td>
                              <td className="px-3 py-2 text-ink">{c.nome}</td>
                              <td className="px-3 py-2 text-muted">{c.email ?? "sem e-mail: não pode ser cobrado"}</td>
                              <td className="px-3 py-2 text-muted">{c.empresa ?? "—"}</td>
                            </tr>
                          );
                        })}
                        {lista.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-muted">
                              Nenhum cliente encontrado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
                <LoadMore
                  hasNextPage={clientes.hasNextPage}
                  isFetchingNextPage={clientes.isFetchingNextPage}
                  isFetchNextPageError={clientes.isFetchNextPageError}
                  fetchNextPage={clientes.fetchNextPage}
                />
                {erros.clientes && <p className="mt-1 text-xs text-red-600">{erros.clientes}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_10rem_8rem]">
                <Field id="descricao" label="Descrição" error={erros.descricao}>
                  <Input
                    id="descricao"
                    maxLength={200}
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    invalid={!!erros.descricao}
                    placeholder="Mensalidade de novembro"
                  />
                </Field>
                <Field id="valor" label="Valor (R$)" error={erros.valor}>
                  <Input
                    id="valor"
                    inputMode="decimal"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    invalid={!!erros.valor}
                    placeholder="150,00"
                  />
                </Field>
                <Field id="vencimento" label="Vence em (dias)" error={erros.vencimento}>
                  <Input
                    id="vencimento"
                    type="number"
                    min={1}
                    max={60}
                    value={vencimentoDias}
                    onChange={(e) => setVencimentoDias(e.target.value)}
                    invalid={!!erros.vencimento}
                  />
                </Field>
              </div>
              <CopiasFields
                prefixo="cobranca"
                cc={cc}
                cco={cco}
                onCc={setCc}
                onCco={setCco}
                erroCc={erros.cc}
                erroCco={erros.cco}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-muted">
                  Uma fatura no Stripe por cliente. O link de pagamento vai por e-mail ao cliente, e você ({user?.email}) recebe o
                  resumo.
                </p>
                <Button type="submit" disabled={emitir.isPending || !stripeOk}>
                  {emitir.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Receipt className="h-4 w-4" aria-hidden="true" />
                  )}
                  {emitir.isPending ? "Emitindo..." : `Emitir cobrança${selecionados.size > 1 ? `s (${selecionados.size})` : ""}`}
                </Button>
              </div>
            </form>
            {emitir.isError && (
              <ErrorAlert className="mt-4" message={getApiErrorMessage(emitir.error, "Não foi possível emitir as cobranças.")} />
            )}
            {emitir.data && <Resultado data={emitir.data} />}
          </FormCard>

          <PagamentosMensais />
          <Recentes />
          <LinhaDoTempoCard />
        </>
      )}
    </div>
  );
};

const WHATSAPP: Record<WhatsappStatus, string | null> = {
  enviado: "WhatsApp enviado",
  ja_enviado: "WhatsApp já tinha sido enviado",
  sem_telefone: "Sem celular no cadastro: WhatsApp não enviado",
  desligado: null, // WhatsApp isn't configured on the API: nothing to say per client
  falhou: "WhatsApp falhou (veja o log da API)",
};

// what happened besides the e-mail: the HubSpot timeline note and the WhatsApp message
function Avisos({ nota, whatsapp }: { nota: boolean | undefined; whatsapp: WhatsappStatus | null }) {
  const texto = whatsapp ? WHATSAPP[whatsapp] : null;
  return (
    <>
      {nota !== undefined && (
        <span className="block text-muted">
          {nota ? "Nota na linha do tempo do HubSpot" : "Sem nota no HubSpot (veja o log)"}
        </span>
      )}
      {texto && (
        <span className={cn("block", whatsapp === "falhou" || whatsapp === "sem_telefone" ? "text-amber-700" : "text-muted")}>
          {texto}
        </span>
      )}
    </>
  );
}
