import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Field, Input, Select } from "../../../components/ui/Field";
import { Modal } from "../../../components/ui/Modal";
import { ErrorAlert } from "../../../components/ui/PageState";
import { MultiSelectCriavel } from "../../../components/ui/MultiSelectCriavel";
import { juntarItens, separarItens } from "../../../lib/itens";
import { getApiErrorMessage } from "../../../lib/api-client";
import { lembrar, useSugestoes } from "../../../lib/sugestoes";
import { EmpresaPicker } from "./EmpresaPicker";
import { Cliente, ClienteForm } from "../api/clientes.api";
import { useSalvarCliente } from "../hooks/useClientes";
import { SENIORIDADE_OPCOES, senioridadeLabel } from "../utils/clientes.labels";
import { CARGOS } from "../utils/cargos";

type Campo = keyof ClienteForm;
const DECISOR = "DECISION_MAKER";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// the ERP's own senioridade, or "" for "use HubSpot's"
const inicial = (cliente: Cliente | null): ClienteForm => ({
  primeiroNome: cliente?.primeiroNome ?? (cliente && !cliente.sobrenome ? cliente.nome : ""),
  sobrenome: cliente?.sobrenome ?? "",
  email: cliente?.email ?? "",
  telefone: cliente?.telefone ?? "",
  empresa: cliente?.empresa ?? "",
  empresaId: cliente?.empresaId ?? null,
  cargo: cliente?.cargo ?? "",
  senioridade: cliente?.senioridadeOrigem === "erp" ? cliente.senioridade : "",
  decisor: cliente?.papeis.includes(DECISOR) ?? false,
});

// novo: a new client must start under a company picked from the list; an edit may leave it empty, but a
// name typed and not picked is never sent as if it were a company
const validar = (form: ClienteForm, novo: boolean, empresaInicial: string) => {
  const erros: Partial<Record<Campo, string>> = {};
  if (!form.primeiroNome.trim()) erros.primeiroNome = "Informe o nome.";
  const nomeEmpresa = form.empresa.trim();
  if (!form.empresaId && (novo || (nomeEmpresa && nomeEmpresa !== empresaInicial))) {
    erros.empresa = nomeEmpresa
      ? "Escolha a empresa na lista (ou \"Criar empresa\") para o cliente ficar ligado a ela."
      : "Escolha a empresa do cliente. Se ela ainda não existe, digite o nome e use \"Criar empresa\".";
  }
  if (form.email.trim() && !EMAIL.test(form.email.trim())) erros.email = "E-mail inválido.";
  if (form.telefone.trim() && !/^[+\d\s().-]{8,40}$/.test(form.telefone.trim())) erros.telefone = "Telefone inválido.";
  return erros;
};

type Props = {
  open: boolean;
  // null: a new client
  cliente: Cliente | null;
  onClose: () => void;
  onSaved?: (cliente: Cliente) => void;
};

// One form for a new client and for editing one. The contact is written to HubSpot (the client's home);
// senioridade stays in the ERP, so it can be set whether or not HubSpot has one.
export function ClienteFormModal({ open, cliente, onClose, onSaved }: Props) {
  const salvar = useSalvarCliente();
  const [form, setForm] = useState<ClienteForm>(() => inicial(cliente));
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const { reset } = salvar;

  useEffect(() => {
    if (!open) return;
    setForm(inicial(cliente));
    setErros({});
    setAviso(null);
    reset();
  }, [open, cliente, reset]);

  const set = (campo: Campo) => (event: { target: { value: string } }) => setForm((f) => ({ ...f, [campo]: event.target.value }));
  const hubspot = cliente?.senioridadeOrigem === "hubspot" ? cliente.senioridade : null;
  const cargosUsados = useSugestoes("cargo", separarItens(cliente?.cargo));
  const opcoesCargo = [...cargosUsados, ...CARGOS.filter((c) => !cargosUsados.some((u) => u.toLocaleLowerCase("pt-BR") === c.toLocaleLowerCase("pt-BR")))];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const encontrados = validar(form, !cliente, cliente?.empresa?.trim() ?? "");
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;
    salvar.mutate(
      { id: cliente?.id ?? null, form: { ...form, senioridade: form.senioridade || null } },
      {
        onSuccess: (salvo) => {
          lembrar("cargo", ...separarItens(form.cargo));
          onSaved?.(salvo.data);
          if (salvo.aviso) setAviso(salvo.aviso);
          else onClose();
        },
      },
    );
  };

  const titulo = cliente ? `Editar ${cliente.nome}` : "Novo cliente";

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={salvar.isPending}
      title={titulo}
      description={cliente ? "As alterações vão para o HubSpot; a senioridade fica no ERP." : "O cliente é criado no HubSpot; a senioridade fica no ERP."}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={salvar.isPending}>
            {aviso ? "Fechar" : "Cancelar"}
          </Button>
          <Button type="submit" form="cliente-form" disabled={salvar.isPending || (!cliente && !form.empresaId)}>
            {salvar.isPending ? "Salvando..." : cliente ? "Salvar alterações" : "Criar cliente"}
          </Button>
        </>
      }
    >
      <form id="cliente-form" noValidate onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        {salvar.error && <ErrorAlert className="sm:col-span-2" message={getApiErrorMessage(salvar.error, "Não foi possível salvar o cliente.")} />}
        {aviso && <ErrorAlert className="sm:col-span-2" message={aviso} />}
        <Field id="cliente-nome" label="Nome" error={erros.primeiroNome}>
          <Input id="cliente-nome" autoFocus autoComplete="off" value={form.primeiroNome} onChange={set("primeiroNome")} invalid={!!erros.primeiroNome} maxLength={100} />
        </Field>
        <Field id="cliente-sobrenome" label="Sobrenome">
          <Input id="cliente-sobrenome" autoComplete="off" value={form.sobrenome} onChange={set("sobrenome")} maxLength={100} />
        </Field>
        <Field id="cliente-email" label="E-mail" error={erros.email} hint="As cobranças chegam por este e-mail.">
          <Input id="cliente-email" type="email" autoComplete="off" value={form.email} onChange={set("email")} invalid={!!erros.email} maxLength={254} />
        </Field>
        <Field id="cliente-telefone" label="Telefone" error={erros.telefone}>
          <Input id="cliente-telefone" type="tel" autoComplete="off" value={form.telefone} onChange={set("telefone")} invalid={!!erros.telefone} maxLength={40} />
        </Field>
        <Field
          id="cliente-empresa"
          label="Empresa"
          error={erros.empresa}
          hint={
            form.empresaId
              ? "O cliente fica ligado a esta empresa no HubSpot."
              : cliente
                ? "Digite 3 ou mais letras para buscar. Vazio, o cliente fica em \"Sem empresa\"."
                : "Obrigatória. Digite 3 ou mais letras para buscar e escolha na lista, ou use \"Criar empresa\"."
          }
        >
          <EmpresaPicker
            id="cliente-empresa"
            value={{ id: form.empresaId, nome: form.empresa }}
            invalid={!!erros.empresa}
            onChange={({ id, nome }) => {
              setForm((f) => ({ ...f, empresaId: id, empresa: nome }));
              if (id) setErros((e) => ({ ...e, empresa: undefined }));
            }}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="cliente-cargo" label="Cargos" hint="Escolha até 5 da lista. Não achou? Digite o cargo e tecle Enter para adicioná-lo (pede confirmação).">
            <MultiSelectCriavel
              id="cliente-cargo"
              item="cargo"
              valores={separarItens(form.cargo)}
              onChange={(valores) => setForm((f) => ({ ...f, cargo: juntarItens(valores) }))}
              opcoes={opcoesCargo}
              max={5}
              maxCaracteres={150}
            />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-accent"
            checked={form.decisor}
            onChange={(e) => setForm((f) => ({ ...f, decisor: e.target.checked }))}
          />
          <span>
            Decisor
            <span className="block text-xs text-muted">Quem decide a compra na empresa (papel "Decision maker" no HubSpot). Aparece primeiro no ranking da empresa.</span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <Field
            id="cliente-senioridade"
            label="Senioridade"
            hint={hubspot ? `No HubSpot: ${senioridadeLabel(hubspot)}. Escolha outra para usar a do ERP.` : "Guardada no ERP, mesmo que o HubSpot não tenha."}
          >
            <Select id="cliente-senioridade" value={form.senioridade ?? ""} onChange={set("senioridade")}>
              <option value="">{hubspot ? `Usar a do HubSpot (${senioridadeLabel(hubspot)})` : "Não definida"}</option>
              {SENIORIDADE_OPCOES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
