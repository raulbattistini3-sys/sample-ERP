import { FormEvent, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Textarea } from "../../../components/ui/Field";
import { Modal } from "../../../components/ui/Modal";
import { ErrorAlert, SuccessAlert } from "../../../components/ui/PageState";
import { getApiErrorMessage } from "../../../lib/api-client";
import { cn } from "../../../lib/cn";
import { NovaAtividade, TipoAtividade } from "../api/atividades.api";
import { useRegistrarAtividade } from "../hooks/useAtividades";

// who the activity is about: a client (it also shows on the client's company) or a company
import { ATIVIDADES } from "../utils/atividades";

export type AlvoDaAtividade = { contatoId?: string | null; empresaId?: string | null; nome: string; email?: string | null };

// "2026-11-13T14:30" in the browser's time zone, the value a datetime-local input takes
const paraInputLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const proximaHoraCheia = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return paraInputLocal(d);
};

type Erros = Partial<Record<"corpo" | "assunto" | "titulo" | "inicio", string>>;

type Props = { open: boolean; alvo: AlvoDaAtividade | null; tipoInicial: TipoAtividade; onClose: () => void };

// Note, e-mail or meeting without leaving the list: written to the HubSpot timeline of the client (and its
// company) or of the company. The e-mail is also sent to the client, with a copy to whoever sends it.
export function AtividadeModal({ open, alvo, tipoInicial, onClose }: Props) {
  const registrar = useRegistrarAtividade();
  const [tipo, setTipo] = useState<TipoAtividade>(tipoInicial);
  const [corpo, setCorpo] = useState("");
  const [assunto, setAssunto] = useState("");
  const [enviar, setEnviar] = useState(true);
  const [titulo, setTitulo] = useState("");
  const [inicio, setInicio] = useState(proximaHoraCheia);
  const [duracao, setDuracao] = useState("30");
  const [local, setLocal] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [feito, setFeito] = useState<string | null>(null);

  const semContato = !alvo?.contatoId;
  const tipos = ATIVIDADES.filter((a) => !(a.tipo === "email" && semContato));

  const validar = (): Erros => {
    const e: Erros = {};
    if (tipo === "nota" && !corpo.trim()) e.corpo = "Escreva a nota.";
    if (tipo === "email") {
      if (!assunto.trim()) e.assunto = "Informe o assunto.";
      if (!corpo.trim()) e.corpo = "Escreva a mensagem.";
    }
    if (tipo === "reuniao") {
      if (!titulo.trim()) e.titulo = "Informe o título.";
      if (!inicio || Number.isNaN(new Date(inicio).getTime())) e.inicio = "Informe a data e a hora.";
    }
    return e;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!alvo) return;
    const encontrados = validar();
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    const ligado = { contatoId: alvo.contatoId ?? null, empresaId: alvo.empresaId ?? null };
    const atividade: NovaAtividade =
      tipo === "nota"
        ? { ...ligado, tipo, corpo }
        : tipo === "email"
          ? { ...ligado, tipo, assunto, corpo, enviar }
          : {
              ...ligado,
              tipo,
              titulo,
              // toISOString keeps the instant; the API wants an offset, "Z" is one
              inicio: new Date(inicio).toISOString(),
              duracaoMinutos: Math.min(1440, Math.max(5, Number(duracao) || 30)),
              local,
              descricao: corpo,
            };
    registrar.mutate(atividade, {
      onSuccess: (criada) => {
        if (criada.aviso) return setFeito(criada.aviso);
        onClose();
      },
    });
  };

  const rotuloEnviar = tipo === "nota" ? "Salvar nota" : tipo === "email" ? (enviar ? "Enviar e-mail" : "Registrar e-mail") : "Agendar reunião";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={registrar.isPending}
      title={alvo ? `Atividade: ${alvo.nome}` : "Atividade"}
      description="Fica na linha do tempo do HubSpot."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={registrar.isPending}>
            {feito ? "Fechar" : "Cancelar"}
          </Button>
          {!feito && (
            <Button type="submit" form="atividade-form" disabled={registrar.isPending}>
              {registrar.isPending ? "Salvando..." : rotuloEnviar}
            </Button>
          )}
        </>
      }
    >
      {feito ? (
        <SuccessAlert message={feito} />
      ) : (
        <form id="atividade-form" onSubmit={handleSubmit} noValidate className="space-y-4">
          {registrar.error && <ErrorAlert message={getApiErrorMessage(registrar.error, "Não foi possível registrar a atividade.")} />}
          <div role="radiogroup" aria-label="Tipo de atividade" className="flex gap-1 rounded-md border border-border p-1">
            {tipos.map(({ tipo: t, label, Icone }) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tipo === t}
                onClick={() => {
                  setTipo(t);
                  setErros({});
                }}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm",
                  tipo === t ? "bg-accent text-white" : "text-ink hover:bg-canvas",
                )}
              >
                <Icone className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {tipo === "email" && (
            <>
              <p className="text-sm text-muted">Para: {alvo?.email ?? "o e-mail do cliente no HubSpot"}</p>
              <Field id="atividade-assunto" label="Assunto" error={erros.assunto}>
                <Input id="atividade-assunto" autoFocus value={assunto} onChange={(e) => setAssunto(e.target.value)} invalid={!!erros.assunto} maxLength={200} />
              </Field>
            </>
          )}

          {tipo === "reuniao" && (
            <>
              <Field id="atividade-titulo" label="Título" error={erros.titulo}>
                <Input id="atividade-titulo" autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} invalid={!!erros.titulo} maxLength={200} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="atividade-inicio" label="Início" error={erros.inicio}>
                  <Input id="atividade-inicio" type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} invalid={!!erros.inicio} />
                </Field>
                <Field id="atividade-duracao" label="Duração (minutos)">
                  <Input id="atividade-duracao" type="number" min={5} max={1440} step={5} value={duracao} onChange={(e) => setDuracao(e.target.value)} />
                </Field>
              </div>
              <Field id="atividade-local" label="Local ou link">
                <Input id="atividade-local" value={local} onChange={(e) => setLocal(e.target.value)} maxLength={500} placeholder="https://meet..." />
              </Field>
            </>
          )}

          <Field
            id="atividade-corpo"
            label={tipo === "nota" ? "Nota" : tipo === "email" ? "Mensagem" : "Pauta (opcional)"}
            error={erros.corpo}
          >
            <Textarea
              id="atividade-corpo"
              autoFocus={tipo === "nota"}
              rows={tipo === "reuniao" ? 3 : 6}
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              invalid={!!erros.corpo}
              maxLength={tipo === "email" ? 10000 : 5000}
            />
          </Field>

          {tipo === "email" && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
              <span>
                Enviar agora
                <span className="block text-xs text-muted">Desmarcado, só registra no HubSpot um e-mail que já foi enviado por fora.</span>
              </span>
            </label>
          )}
        </form>
      )}
    </Modal>
  );
}
