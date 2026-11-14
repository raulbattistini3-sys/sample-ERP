import { useMemo, useState } from "react";
import { Link2, Search } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Field, Input } from "../../../components/ui/Field";
import { ErrorAlert, FormCard, SuccessAlert } from "../../../components/ui/PageState";
import { useDebounced } from "../../../hooks/useDebounced";
import { getApiErrorMessage } from "../../../lib/api-client";
import { Cliente } from "../api/clientes.api";
import { useClientes, useClientesDaEmpresa, useVincularClientes } from "../hooks/useClientes";

// The company's clientes, and linking the ones registered before it existed (or under another company):
// each picked cliente moves under this one, the same as saving it with this Empresa chosen.
export function EmpresaClientes({ empresaId, empresaNome }: { empresaId: string; empresaNome: string }) {
  const daEmpresa = useClientesDaEmpresa(empresaId);
  const vincular = useVincularClientes(empresaId);
  const [busca, setBusca] = useState("");
  const termo = useDebounced(busca.trim(), 300);
  const resultados = useClientes(termo, termo.length >= 2);
  const [escolhidos, setEscolhidos] = useState<Map<string, Cliente>>(new Map());
  const [resultado, setResultado] = useState<{ ok: number; falhas: string[] } | null>(null);

  const ligados = useMemo(() => new Set((daEmpresa.data ?? []).map((c) => c.id)), [daEmpresa.data]);
  const candidatos = (resultados.data?.pages.flatMap((p) => p.data) ?? []).filter((c) => !ligados.has(c.id));

  const alternar = (c: Cliente) =>
    setEscolhidos((atual) => {
      const novo = new Map(atual);
      if (novo.has(c.id)) novo.delete(c.id);
      else novo.set(c.id, c);
      return novo;
    });

  const ligar = () => {
    setResultado(null);
    const lista = [...escolhidos.values()];
    vincular.mutate(
      lista.map((c) => c.id),
      {
        onSuccess: (r) => {
          const nome = new Map(lista.map((c) => [c.id, c.nome || c.email || c.id]));
          setResultado({ ok: r.vinculados.length, falhas: r.falhas.map((f) => `${nome.get(f.clienteId)}: ${f.mensagem}`) });
          setEscolhidos(new Map([...escolhidos].filter(([id]) => r.falhas.some((f) => f.clienteId === id))));
        },
      },
    );
  };

  return (
    <FormCard className="mt-6">
      <h2 className="text-base font-semibold text-ink">Clientes da empresa</h2>
      <p className="mt-1 text-sm text-muted">
        Cadastrou um cliente antes da empresa? Procure por ele e ligue a {empresaNome}. Um cliente fica em uma empresa só: se estiver em outra, ele sai dela.
      </p>

      <div className="mt-4">
        {daEmpresa.isLoading && <p className="text-sm text-muted">Carregando clientes...</p>}
        {daEmpresa.error && <ErrorAlert message={getApiErrorMessage(daEmpresa.error, "Não foi possível carregar os clientes da empresa.")} />}
        {daEmpresa.data && daEmpresa.data.length === 0 && <p className="text-sm text-muted">Nenhum cliente ligado a esta empresa ainda.</p>}
        {daEmpresa.data && daEmpresa.data.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {daEmpresa.data.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="text-ink">{c.nome || "Sem nome"}</span>
                <span className="text-muted">{[c.cargo, c.email].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 space-y-3">
        <Field id="empresa-ligar-busca" label="Ligar clientes existentes" hint="Digite ao menos 2 letras do nome ou do e-mail.">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input id="empresa-ligar-busca" className="pl-9" autoComplete="off" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente" />
          </div>
        </Field>

        {termo.length >= 2 && (
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            {resultados.isLoading && <p className="p-3 text-sm text-muted">Buscando...</p>}
            {resultados.error && <ErrorAlert className="m-2" message={getApiErrorMessage(resultados.error, "Não foi possível buscar os clientes.")} />}
            {!resultados.isLoading && !resultados.error && candidatos.length === 0 && <p className="p-3 text-sm text-muted">Nenhum cliente fora desta empresa encontrado.</p>}
            <ul className="divide-y divide-border text-sm">
              {candidatos.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-canvas">
                    <input type="checkbox" checked={escolhidos.has(c.id)} onChange={() => alternar(c)} />
                    <span className="flex-1 text-ink">
                      {c.nome || "Sem nome"} <span className="text-muted">{c.email}</span>
                    </span>
                    <span className={c.empresaId ? "text-xs text-amber-700" : "text-xs text-muted"}>{c.empresaId ? `Em ${c.empresa ?? "outra empresa"}` : "Sem empresa"}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {vincular.error && <ErrorAlert message={getApiErrorMessage(vincular.error, "Não foi possível ligar os clientes.")} />}
        {resultado && resultado.ok > 0 && <SuccessAlert message={`${resultado.ok} cliente(s) ligado(s) a ${empresaNome}.`} />}
        {resultado && resultado.falhas.length > 0 && <ErrorAlert message={resultado.falhas.join(" ")} />}

        <div className="flex justify-end">
          <Button type="button" onClick={ligar} disabled={escolhidos.size === 0 || escolhidos.size > 100 || vincular.isPending}>
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {vincular.isPending ? "Ligando..." : `Ligar ${escolhidos.size || ""} cliente(s) a esta empresa`}
          </Button>
        </div>
      </div>
    </FormCard>
  );
}
