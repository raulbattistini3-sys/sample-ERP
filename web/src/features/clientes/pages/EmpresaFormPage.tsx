import { FormEvent, useState } from "react";
import { setorLabel } from "../utils/setores";
import { useNavigate, useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Estagio, ESTAGIO_LABEL, ESTAGIOS, TipoAtividade } from "../api/atividades.api";
import { useMoverEmpresa, useResponsaveis } from "../hooks/useAtividades";
import { AtividadeModal } from "../components/AtividadeModal";
import { AtalhosDeAtividade } from "../components/ClienteAcoes";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, LoadingState, PageHeader } from "../../../components/ui/PageState";
import { Sugestoes } from "../../../components/ui/Sugestoes";
import { getApiErrorMessage } from "../../../lib/api-client";
import { lembrar } from "../../../lib/sugestoes";
import { EmpresaDetalhe, EmpresaForm } from "../api/clientes.api";
import { useEmpresa, useSalvarEmpresa, useSetores } from "../hooks/useClientes";
import { EmpresaClientes } from "../components/EmpresaClientes";

type Erros = Partial<Record<keyof EmpresaForm, string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inicial = (e?: EmpresaDetalhe): EmpresaForm => ({
  nome: e?.nome ?? "",
  dominio: e?.dominio ?? "",
  setor: e?.setor ?? "",
  telefone: e?.telefone ?? "",
  cidade: e?.cidade ?? "",
  estado: e?.estado ?? "",
  pais: e?.pais ?? (e ? "" : "Brasil"),
  site: e?.site ?? "",
  descricao: e?.descricao ?? "",
  emailSac: e?.emailSac ?? "",
  responsavelId: e?.responsavelId ?? "",
});

// the API checks the same; this only answers sooner
const validar = (f: EmpresaForm): Erros => {
  const erros: Erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome da empresa.";
  if (f.emailSac.trim() && !EMAIL.test(f.emailSac.trim())) erros.emailSac = "E-mail de SAC inválido.";
  if (f.telefone.trim() && !/^[+\d\s().-]{8,40}$/.test(f.telefone.trim())) erros.telefone = "Telefone inválido.";
  if (f.dominio.trim() && !/^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?/i.test(f.dominio.trim())) erros.dominio = "Domínio inválido (ex.: empresa.com.br).";
  return erros;
};

export function EmpresaFormPage() {
  const { id = "" } = useParams();
  const { data: empresa, isLoading, error } = useEmpresa(id);

  if (!id) return <EmpresaFormulario />;
  if (isLoading) return <LoadingState />;
  if (error || !empresa) return <ErrorAlert message={getApiErrorMessage(error, "Empresa não encontrada.")} />;
  return <EmpresaFormulario key={empresa.id} empresa={empresa} />;
}

// Criar empresa / Editar empresa: the company lives in HubSpot (written there); the SAC e-mail stays in the
// ERP and is copied on the e-mails about its clients' failed payments.
function EmpresaFormulario({ empresa }: { empresa?: EmpresaDetalhe }) {
  const navigate = useNavigate();
  const salvar = useSalvarEmpresa();
  const setores = useSetores();
  const [form, setForm] = useState<EmpresaForm>(() => inicial(empresa));
  const [erros, setErros] = useState<Erros>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const responsaveis = useResponsaveis();
  const mover = useMoverEmpresa();
  const [estagio, setEstagio] = useState<Estagio>(empresa?.estagio ?? "nao_contatado");
  const [atividade, setAtividade] = useState<{ tipo: TipoAtividade; n: number } | null>(null);

  const voltar = () => navigate("/clientes");
  const set = (campo: keyof EmpresaForm) => (event: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [campo]: event.target.value }));
    setErros((e) => ({ ...e, [campo]: undefined }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const encontrados = validar(form);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    salvar.mutate(
      { id: empresa?.id ?? null, form },
      {
        onSuccess: (salva) => {
          // the stage has its own HubSpot rule (moving back clears it first), so it goes on its own call
          const antes = empresa?.estagio ?? "nao_contatado";
          if (antes !== estagio) mover.mutate({ id: salva.data.id, de: antes, para: estagio });
          lembrar("cidade", form.cidade);
          lembrar("estado", form.estado);
          lembrar("pais", form.pais);
          if (salva.aviso) setAviso(salva.aviso);
          // a new company opens on its own page, where the clientes registered before it can be linked
          if (!empresa) navigate(`/clientes/empresas/${salva.data.id}`, { replace: true, state: { criada: true } });
          else if (!salva.aviso) voltar();
        },
      },
    );
  };

  // the current value stays selectable even if HubSpot no longer lists it
  // labelled in Portuguese (utils/setores.ts) and sorted by that label
  const opcoesSetor = (setores.data ?? [])
    .map((o) => ({ value: o.value, label: setorLabel(o.value, new Map([[o.value, o.label]])) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const setorAtual = form.setor && !opcoesSetor.some((o) => o.value === form.setor) ? [{ value: form.setor, label: setorLabel(form.setor) }] : [];

  return (
    <div>
      <PageHeader
        title={empresa ? `Editar ${empresa.nome}` : "Nova empresa"}
        actions={
          empresa?.url && (
            <>
            <span className="flex gap-1">
              <AtalhosDeAtividade nome={empresa.nome} comEmail={false} onAtividade={(tipo) => setAtividade({ tipo, n: Date.now() })} />
            </span>
            <a
              href={empresa.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-ink hover:bg-canvas"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir no HubSpot
            </a>
            </>
          )
        }
      />

      <FormCard>
        {salvar.error && <ErrorAlert className="mb-4" message={getApiErrorMessage(salvar.error, "Não foi possível salvar a empresa.")} />}
        {aviso && <ErrorAlert className="mb-4" message={aviso} />}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="empresa-nome" label="Nome" error={erros.nome}>
              <Input id="empresa-nome" autoFocus autoComplete="organization" value={form.nome} onChange={set("nome")} invalid={!!erros.nome} maxLength={150} />
            </Field>
            <Field id="empresa-dominio" label="Domínio" error={erros.dominio} hint="O HubSpot reconhece a empresa por ele (ex.: empresa.com.br).">
              <Input id="empresa-dominio" autoComplete="off" placeholder="empresa.com.br" value={form.dominio} onChange={set("dominio")} invalid={!!erros.dominio} maxLength={253} />
            </Field>
            <Field
              id="empresa-sac"
              label="E-mail de SAC"
              error={erros.emailSac}
              hint="Recebe cópia quando um pagamento de um cliente desta empresa falha, para alguém acompanhar."
            >
              <Input id="empresa-sac" type="email" autoComplete="off" placeholder="sac@empresa.com.br" value={form.emailSac} onChange={set("emailSac")} invalid={!!erros.emailSac} maxLength={254} />
            </Field>
            <Field id="empresa-telefone" label="Telefone" error={erros.telefone}>
              <Input id="empresa-telefone" type="tel" autoComplete="tel" value={form.telefone} onChange={set("telefone")} invalid={!!erros.telefone} maxLength={40} />
            </Field>
            <Field
              id="empresa-setor"
              label="Setor"
              hint={setores.error ? getApiErrorMessage(setores.error, "Não foi possível carregar os setores do HubSpot.") : setores.isLoading ? "Carregando setores..." : undefined}
            >
              <Select id="empresa-setor" value={form.setor} onChange={set("setor")} disabled={setores.isLoading && !form.setor}>
                <option value="">Não informado</option>
                {[...setorAtual, ...opcoesSetor].map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id="empresa-responsavel"
              label="Responsável"
              hint={
                responsaveis.error
                  ? getApiErrorMessage(responsaveis.error, "Não foi possível ler os usuários do HubSpot (falta a permissão crm.objects.owners.read?).")
                  : "O usuário do HubSpot dono da empresa."
              }
            >
              <Select id="empresa-responsavel" value={form.responsavelId} onChange={set("responsavelId")} disabled={responsaveis.isLoading && !form.responsavelId}>
                <option value="">Sem responsável</option>
                {form.responsavelId && !responsaveis.data?.some((r) => r.id === form.responsavelId) && (
                  <option value={form.responsavelId}>{responsaveis.isLoading ? "Carregando..." : `Usuário ${form.responsavelId}`}</option>
                )}
                {(responsaveis.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                    {r.email ? ` (${r.email})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="empresa-estagio" label="Etapa do funil" hint="Muda sozinha para Cliente quando uma cobrança é paga.">
              <Select id="empresa-estagio" value={estagio} onChange={(e) => setEstagio(e.target.value as Estagio)}>
                {ESTAGIOS.map((e) => (
                  <option key={e} value={e}>
                    {ESTAGIO_LABEL[e]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="empresa-site" label="Site">
              <Input id="empresa-site" type="url" autoComplete="url" placeholder="https://" value={form.site} onChange={set("site")} maxLength={500} />
            </Field>
            <Field id="empresa-cidade" label="Cidade">
              <Input id="empresa-cidade" name="cidade" autoComplete="address-level2" list="empresa-cidade-sugestoes" value={form.cidade} onChange={set("cidade")} maxLength={100} />
              <Sugestoes id="empresa-cidade-sugestoes" campo="cidade" />
            </Field>
            <Field id="empresa-estado" label="Estado">
              <Input id="empresa-estado" name="estado" autoComplete="address-level1" list="empresa-estado-sugestoes" value={form.estado} onChange={set("estado")} maxLength={100} />
              <Sugestoes id="empresa-estado-sugestoes" campo="estado" />
            </Field>
            <Field id="empresa-pais" label="País">
              <Input id="empresa-pais" name="pais" autoComplete="country-name" list="empresa-pais-sugestoes" value={form.pais} onChange={set("pais")} maxLength={100} />
              <Sugestoes id="empresa-pais-sugestoes" campo="pais" extras={["Brasil"]} />
            </Field>
          </div>
          <Field id="empresa-descricao" label="Descrição">
            <Textarea id="empresa-descricao" rows={3} value={form.descricao} onChange={set("descricao")} maxLength={2000} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={voltar}>
              {aviso ? "Voltar" : "Cancelar"}
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : empresa ? "Salvar alterações" : "Criar empresa"}
            </Button>
          </div>
        </form>
      </FormCard>

      {empresa && <EmpresaClientes empresaId={empresa.id} empresaNome={empresa.nome} />}
      {empresa && atividade && (
        <AtividadeModal
          key={atividade.n}
          open
          alvo={{ empresaId: empresa.id, nome: empresa.nome }}
          tipoInicial={atividade.tipo}
          onClose={() => setAtividade(null)}
        />
      )}
    </div>
  );
}
