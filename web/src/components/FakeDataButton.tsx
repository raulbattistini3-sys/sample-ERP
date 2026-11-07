import { useSingleFlightMutation } from "../hooks/useSingleFlightMutation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "./ui/Button";
import { apiClient, getApiErrorMessage } from "../lib/api-client";
import { useAuth } from "../context/AuthContext";
import { isAdminRole } from "../lib/permissoes";

// "Gerar dados fictícios" on the list pages. The API offers /dev/fake-data only with API_ENV=development
// (api/src/fake_data/fake_data.routes.ts), so in production the check below gets a 404 and the button
// never shows. ADM/SU only, like the routes.

export type FakeDataTipo = "produtos" | "categorias" | "usuarios" | "auditorias";

type Resultado = Record<string, unknown>;

const TIPOS: Record<
   FakeDataTipo,
   { padrao?: number; maximo?: number; pergunta: string; listas: string[]; resumo: (r: Resultado) => string }
> = {
   produtos: {
      padrao: 500,
      maximo: 20000,
      pergunta: "Quantos produtos fictícios criar? (SKUs começam com FK-)",
      listas: ["products"],
      resumo: (r) => (r.motivo ? String(r.motivo) : `${r.criados} produtos criados (lote ${r.lote}).`),
   },
   usuarios: {
      padrao: 5,
      maximo: 200,
      pergunta: "Quantos usuários fictícios criar? (e-mails @demo.local)",
      listas: ["usuarios"],
      resumo: (r) => `${r.criados} usuários criados; senha de todos: ${r.senha}.`,
   },
   categorias: {
      pergunta:
         "Os nomes de categoria são fixos (10). Criar as que estiverem faltando?",
      listas: ["categorias", "products"],
      resumo: (r) => {
         const criadas = (r.criadas as string[]) ?? [];
         return criadas.length ? `Criadas: ${criadas.join(", ")}.` : String(r.motivo ?? "Nada a criar.");
      },
   },
   auditorias: {
      padrao: 10,
      maximo: 200,
      pergunta:
         "Teste de auditoria: para quantos produtos alterar o valor de venda e depois voltar ao anterior? " +
         "Cada um gera 2 auditorias automáticas (enviadas às integrações conectadas, como uma edição real).",
      listas: ["auditorias", "products"],
      resumo: (r) => {
         const falhas = (r.falhas as string[]) ?? [];
         return `${r.produtos} produtos alterados e restaurados, ${r.auditorias} auditorias.` +
            (falhas.length ? ` ${falhas.length} falharam: ${falhas.slice(0, 2).join("; ")}` : "");
      },
   },
};

const useFakeDataDisponivel = (habilitado: boolean) =>
   useQuery({
      queryKey: ["fake-data", "disponivel"],
      queryFn: () => apiClient.get("/dev/fake-data").then(() => true),
      enabled: habilitado,
      retry: false,
      staleTime: Infinity,
   });

export function FakeDataButton({ tipo }: { tipo: FakeDataTipo }) {
   const { user } = useAuth();
   const admin = isAdminRole(user?.permissoes);
   const disponivel = useFakeDataDisponivel(admin);
   const queryClient = useQueryClient();
   const [mensagem, setMensagem] = useState<{ texto: string; erro: boolean } | null>(null);
   const config = TIPOS[tipo];

   const gerar = useSingleFlightMutation({
      mutationFn: (quantidade?: number) =>
         apiClient.post<{ data: Resultado }>(`/dev/fake-data/${tipo}`, quantidade ? { quantidade } : {}).then((r) => r.data.data),
      onSuccess: (resultado) => {
         config.listas.forEach((lista) => queryClient.invalidateQueries({ queryKey: [lista] }));
         setMensagem({ texto: config.resumo(resultado), erro: false });
      },
      onError: (error) => setMensagem({ texto: getApiErrorMessage(error, "Não foi possível gerar os dados."), erro: true }),
   });

   // the result stays a few seconds, then gets out of the way
   useEffect(() => {
      if (!mensagem) return;
      const timer = setTimeout(() => setMensagem(null), 10_000);
      return () => clearTimeout(timer);
   }, [mensagem]);

   if (!admin || !disponivel.data) return null;

   const aoClicar = () => {
      if (config.padrao === undefined) {
         if (window.confirm(config.pergunta)) gerar.mutate(undefined);
         return;
      }
      const resposta = window.prompt(config.pergunta, String(config.padrao));
      if (resposta === null) return;
      const quantidade = Number(resposta);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > (config.maximo ?? Infinity)) {
         setMensagem({ texto: `Informe um número inteiro entre 1 e ${config.maximo}.`, erro: true });
         return;
      }
      gerar.mutate(quantidade);
   };

   return (
      <>
         {mensagem && (
            <span role="status" className={mensagem.erro ? "text-sm text-red-600" : "text-sm text-muted"}>
               {mensagem.texto}
            </span>
         )}
         <Button variant="secondary" onClick={aoClicar} disabled={gerar.isPending} title="Disponível só em desenvolvimento">
            {gerar.isPending ? (
               <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
               <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            Gerar dados fictícios
         </Button>
      </>
   );
}
