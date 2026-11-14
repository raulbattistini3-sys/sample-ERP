import { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select } from "../../../components/ui/Field";
import { Modal } from "../../../components/ui/Modal";
import { ErrorAlert } from "../../../components/ui/PageState";
import { useDebounced } from "../../../hooks/useDebounced";
import { getApiErrorMessage } from "../../../lib/api-client";
import { formatCurrency } from "../../../lib/form";
import { Cliente } from "../../clientes/api/clientes.api";
import { useClientes } from "../../clientes/hooks/useClientes";
import { PagamentoMensal, Unidade } from "../api/recorrentes.api";
import { useSalvarPagamentoMensal } from "../hooks/usePagamentosMensais";
import { CopiasFields } from "./CopiasFields";
import { erroDaLista, listaDeEmails } from "../utils/copias";
import { dataDoCiclo, formatDia, frequenciaLabel, hojeISO, parseReais, reaisInput } from "../utils/valores";

type ClienteEscolhido = Pick<Cliente, "id" | "nome" | "email">;

type Form = {
  descricao: string;
  valor: string;
  valorMaximo: string;
  valorMinimo: string;
  intervalo: string;
  unidade: Unidade;
  vencimentoDias: string;
  dataInicio: string;
  dataFim: string;
  cc: string;
  cco: string;
};
type Campo = keyof Form | "cliente";

const inicial = (plano: PagamentoMensal | null): Form =>
  plano
    ? {
        descricao: plano.descricao,
        valor: reaisInput(plano.valorCentavos),
        valorMaximo: reaisInput(plano.valorMaximoCentavos),
        valorMinimo: reaisInput(plano.valorMinimoCentavos),
        intervalo: String(plano.intervalo),
        unidade: plano.unidade,
        vencimentoDias: String(plano.vencimentoDias),
        dataInicio: plano.dataInicio,
        dataFim: plano.dataFim ?? "",
        cc: (plano.cc ?? []).join(", "),
        cco: (plano.cco ?? []).join(", "),
      }
    : { descricao: "", valor: "", valorMaximo: "", valorMinimo: "", intervalo: "1", unidade: "meses", vencimentoDias: "3", dataInicio: hojeISO(), dataFim: "", cc: "", cco: "" };

// Same rules as the API (PlanoSchema); the API checks again.
const validar = (f: Form, cliente: ClienteEscolhido | null, novo: boolean) => {
  const e: Partial<Record<Campo, string>> = {};
  const valor = parseReais(f.valor);
  const max = parseReais(f.valorMaximo);
  const min = f.valorMinimo.trim() ? parseReais(f.valorMinimo) : null;
  if (novo && !cliente) e.cliente = "Escolha o cliente.";
  else if (novo && !cliente?.email) e.cliente = "Este cliente não tem e-mail: cadastre um em Clientes, cada cobrança vai por e-mail.";
  if (!f.descricao.trim()) e.descricao = "Informe a descrição.";
  if (!(valor >= 1) || valor > 1_000_000) e.valor = "Entre R$ 1,00 e R$ 1.000.000,00.";
  if (!(max >= 1) || max > 1_000_000) e.valorMaximo = "Entre R$ 1,00 e R$ 1.000.000,00.";
  else if (max < valor) e.valorMaximo = "Precisa ser maior ou igual ao valor da cobrança.";
  if (min !== null && (!(min >= 1) || min > 1_000_000)) e.valorMinimo = "Entre R$ 1,00 e R$ 1.000.000,00.";
  else if (min !== null && min > valor) e.valorMinimo = "Precisa ser menor ou igual ao valor da cobrança.";
  const n = Number(f.intervalo);
  const [lo, hi] = f.unidade === "meses" ? [1, 12] : [1, 365];
  if (novo && (!Number.isInteger(n) || n < lo || n > hi)) e.intervalo = f.unidade === "meses" ? "De 1 a 12 meses." : "De 1 a 365 dias.";
  const venc = Number(f.vencimentoDias);
  if (!Number.isInteger(venc) || venc < 1 || venc > 60) e.vencimentoDias = "De 1 a 60 dias.";
  if (novo && !/^\d{4}-\d{2}-\d{2}$/.test(f.dataInicio)) e.dataInicio = "Informe a data.";
  else if (novo && f.dataInicio < hojeISO()) e.dataInicio = "Não pode ser no passado.";
  if (f.dataFim && f.dataFim < f.dataInicio) e.dataFim = "Precisa ser depois do início.";
  const erroCc = erroDaLista(f.cc);
  const erroCco = erroDaLista(f.cco);
  if (erroCc) e.cc = erroCc;
  if (erroCco) e.cco = erroCco;
  return { erros: e, valor, max, min, intervalo: n, vencimentoDias: venc };
};

// search HubSpot's clients and pick one
function EscolherCliente({ escolhido, onEscolher, erro }: { escolhido: ClienteEscolhido | null; onEscolher: (c: ClienteEscolhido | null) => void; erro?: string }) {
  const [busca, setBusca] = useState("");
  const termo = useDebounced(busca.trim());
  const clientes = useClientes(termo, !escolhido);
  const lista = clientes.data?.pages.flatMap((p) => p.data).slice(0, 8) ?? [];

  if (escolhido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-sm">
        <span>
          <span className="font-medium text-ink">{escolhido.nome}</span>
          <span className="block text-xs text-muted">{escolhido.email ?? "sem e-mail"}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEscolher(null)}>
          Trocar
        </Button>
      </div>
    );
  }
  return (
    <Field id="pm-cliente" label="Cliente" error={erro}>
      <Input id="pm-cliente" placeholder="Buscar por nome, e-mail ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} invalid={!!erro} autoComplete="off" />
      <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm" aria-label="Clientes encontrados">
        {clientes.isLoading && <li className="px-3 py-2 text-muted">Buscando...</li>}
        {!clientes.isLoading && lista.length === 0 && <li className="px-3 py-2 text-muted">Nenhum cliente encontrado.</li>}
        {lista.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onEscolher(c)} className="w-full px-3 py-2 text-left hover:bg-canvas">
              <span className="font-medium text-ink">{c.nome}</span>
              <span className="block text-xs text-muted">{c.email ?? "sem e-mail — não pode receber cobranças"}{c.empresa ? ` · ${c.empresa}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  // editing an existing plan; null for a new one
  plano?: PagamentoMensal | null;
  // a new plan for this client (opened from Clientes); otherwise the modal asks for one
  cliente?: ClienteEscolhido | null;
};

// Pagamento mensal, after Pix Automático: the client authorizes a ceiling per charge, the ERP charges the
// agreed value on every cycle by an invoice (Pix or card) e-mailed to them, until the end date or a cancel.
export function PagamentoMensalModal({ open, onClose, plano = null, cliente = null }: Props) {
  const salvar = useSalvarPagamentoMensal();
  const { reset } = salvar;
  const novo = !plano;
  const [form, setForm] = useState<Form>(() => inicial(plano));
  const [escolhido, setEscolhido] = useState<ClienteEscolhido | null>(cliente);
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});

  useEffect(() => {
    if (!open) return;
    setForm(inicial(plano));
    setEscolhido(plano?.cliente ?? cliente);
    setErros({});
    reset();
  }, [open, plano, cliente, reset]);

  const set = (campo: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  // the next charges, as the scheduler will issue them
  const proximas = useMemo(() => {
    const n = Number(form.intervalo);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dataInicio) || !Number.isInteger(n) || n < 1) return [];
    const desde = plano ? plano.proximoCiclo : 0;
    const datas: string[] = [];
    for (let i = desde; datas.length < 4; i++) {
      const d = dataDoCiclo(form.dataInicio, n, form.unidade, i);
      if (form.dataFim && d > form.dataFim) break;
      datas.push(d);
    }
    return datas;
  }, [form.dataInicio, form.intervalo, form.unidade, form.dataFim, plano]);

  const valorAtual = parseReais(form.valor);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const v = validar(form, escolhido, novo);
    setErros(v.erros);
    if (Object.keys(v.erros).length > 0) return;
    const comum = { descricao: form.descricao.trim(), valor: v.valor, valorMaximo: v.max, valorMinimo: v.min, vencimentoDias: v.vencimentoDias, dataFim: form.dataFim || null, cc: listaDeEmails(form.cc), cco: listaDeEmails(form.cco) };
    salvar.mutate(
      plano
        ? { id: plano.id, alteracao: comum }
        : { id: null, novo: { ...comum, clienteId: escolhido!.id, intervalo: v.intervalo, unidade: form.unidade, dataInicio: form.dataInicio } },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={salvar.isPending}
      size="lg"
      title={novo ? "Pagamento mensal" : "Alterar pagamento mensal"}
      description={
        novo
          ? "Uma cobrança recorrente: em cada data o cliente recebe por e-mail a fatura para pagar por Pix ou cartão."
          : "Vale a partir da próxima cobrança. Para mudar a frequência ou o início, cancele e crie outro."
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="pagamento-mensal-form" disabled={salvar.isPending}>
            {salvar.isPending ? "Salvando..." : novo ? "Ativar pagamento mensal" : "Salvar alterações"}
          </Button>
        </>
      }
    >
      <form id="pagamento-mensal-form" noValidate onSubmit={handleSubmit} className="space-y-5">
        {salvar.error && <ErrorAlert message={getApiErrorMessage(salvar.error, "Não foi possível salvar o pagamento mensal.")} />}

        {novo && !cliente ? (
          <EscolherCliente escolhido={escolhido} onEscolher={setEscolhido} erro={erros.cliente} />
        ) : (
          <div className="rounded-md border border-border bg-canvas px-3 py-2 text-sm">
            <span className="font-medium text-ink">{escolhido?.nome ?? "Cliente"}</span>
            <span className="block text-xs text-muted">{escolhido?.email ?? "sem e-mail"}</span>
            {erros.cliente && <p className="mt-1 text-xs text-red-700">{erros.cliente}</p>}
          </div>
        )}

        <Field id="pm-descricao" label="Descrição" error={erros.descricao} hint="Aparece na fatura, seguida da data de cada cobrança.">
          <Input id="pm-descricao" value={form.descricao} onChange={set("descricao")} invalid={!!erros.descricao} maxLength={200} placeholder="Mensalidade do plano" />
        </Field>

        <fieldset className="space-y-3">
          <legend className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
            Valores
          </legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="pm-valor" label="Valor de cada cobrança" error={erros.valor}>
              <Input id="pm-valor" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={set("valor")} invalid={!!erros.valor} />
            </Field>
            <Field id="pm-maximo" label="Valor máximo autorizado" error={erros.valorMaximo} hint="Teto por cobrança, como no Pix Automático.">
              <Input
                id="pm-maximo"
                inputMode="decimal"
                placeholder={valorAtual >= 1 ? reaisInput(Math.round(valorAtual * 100)) : "0,00"}
                value={form.valorMaximo}
                onChange={set("valorMaximo")}
                onFocus={() => !form.valorMaximo && valorAtual >= 1 && setForm((f) => ({ ...f, valorMaximo: f.valor }))}
                invalid={!!erros.valorMaximo}
              />
            </Field>
            <Field id="pm-minimo" label="Valor mínimo (opcional)" error={erros.valorMinimo} hint="Piso: nenhuma cobrança sai abaixo dele.">
              <Input id="pm-minimo" inputMode="decimal" placeholder="—" value={form.valorMinimo} onChange={set("valorMinimo")} invalid={!!erros.valorMinimo} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <CalendarClock className="h-4 w-4 text-accent" aria-hidden="true" />
            Agenda
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pm-intervalo" label="Cobrar a cada" error={erros.intervalo} hint={novo ? undefined : "Fixa depois de criado."}>
              <div className="flex gap-2">
                <Input id="pm-intervalo" type="number" min={1} max={form.unidade === "meses" ? 12 : 365} className="w-24" value={form.intervalo} onChange={set("intervalo")} disabled={!novo} invalid={!!erros.intervalo} />
                <Select aria-label="Unidade" value={form.unidade} onChange={set("unidade")} disabled={!novo}>
                  <option value="meses">mês(es)</option>
                  <option value="dias">dia(s)</option>
                </Select>
              </div>
            </Field>
            <Field id="pm-vencimento" label="Prazo para pagar (dias)" error={erros.vencimentoDias} hint="Depois de cada cobrança emitida.">
              <Input id="pm-vencimento" type="number" min={1} max={60} value={form.vencimentoDias} onChange={set("vencimentoDias")} invalid={!!erros.vencimentoDias} />
            </Field>
            <Field id="pm-inicio" label="Primeira cobrança" error={erros.dataInicio}>
              <Input id="pm-inicio" type="date" min={hojeISO()} value={form.dataInicio} onChange={set("dataInicio")} disabled={!novo} invalid={!!erros.dataInicio} />
            </Field>
            <Field id="pm-fim" label="Até (opcional)" error={erros.dataFim} hint="Sem data, segue até ser cancelado.">
              <Input id="pm-fim" type="date" min={form.dataInicio} value={form.dataFim} onChange={set("dataFim")} invalid={!!erros.dataFim} />
            </Field>
          </div>
        </fieldset>

        <CopiasFields
          prefixo="pm"
          cc={form.cc}
          cco={form.cco}
          onCc={(v) => setForm((f) => ({ ...f, cc: v }))}
          onCco={(v) => setForm((f) => ({ ...f, cco: v }))}
          erroCc={erros.cc}
          erroCco={erros.cco}
        />

        <div className="rounded-md border border-border bg-canvas px-3 py-2 text-sm" aria-live="polite">
          <p className="font-medium text-ink">
            {Number(form.intervalo) >= 1 ? frequenciaLabel(Number(form.intervalo), form.unidade) : "—"}
            {valorAtual >= 1 && ` · ${formatCurrency(valorAtual)}`}
          </p>
          <p className="text-xs text-muted">
            {proximas.length ? `Próximas cobranças: ${proximas.map(formatDia).join(", ")}${proximas.length === 4 ? "…" : ""}` : "Nenhuma cobrança no período."}
          </p>
        </div>
      </form>
    </Modal>
  );
}
