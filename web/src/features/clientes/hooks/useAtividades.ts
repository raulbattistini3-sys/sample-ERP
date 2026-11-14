import { InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ColunaDoFunil, Estagio, getFunil, getResponsaveis, moverEmpresa, NovaAtividade, registrarAtividade } from "../api/atividades.api";

export const useRegistrarAtividade = () => useMutation({ mutationFn: (a: NovaAtividade) => registrarAtividade(a) });

export const useResponsaveis = () => useQuery({ queryKey: ["clientes", "responsaveis"], queryFn: getResponsaveis, staleTime: 5 * 60 * 1000 });

const FUNIL = ["clientes", "funil"] as const;

export const useColunaDoFunil = (estagio: Estagio, busca: string, porPagina: number) =>
  useInfiniteQuery({
    queryKey: [...FUNIL, estagio, busca, porPagina],
    queryFn: ({ pageParam }) => getFunil(estagio, pageParam, busca, porPagina),
    initialPageParam: null as string | null,
    getNextPageParam: (ultima) => ultima.proxima,
  });

type Coluna = InfiniteData<ColunaDoFunil, string | null>;

// moves the card at once (HubSpot search only sees the change a few seconds later), then refetches
export function useMoverEmpresa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, para }: { id: string; de: Estagio; para: Estagio }) => moverEmpresa(id, para),
    onMutate: async ({ id, de, para }) => {
      await queryClient.cancelQueries({ queryKey: FUNIL });
      const antes = queryClient.getQueriesData<Coluna>({ queryKey: FUNIL });
      let movida: ColunaDoFunil["data"][number] | undefined;
      queryClient.setQueriesData<Coluna>({ queryKey: [...FUNIL, de] }, (coluna) => {
        if (!coluna) return coluna;
        return {
          ...coluna,
          pages: coluna.pages.map((p) => {
            const achada = p.data.find((e) => e.id === id);
            if (!achada) return p;
            movida = achada;
            return { ...p, data: p.data.filter((e) => e.id !== id), total: Math.max(0, p.total - 1) };
          }),
        };
      });
      if (movida) {
        const card = { ...movida, estagio: para };
        queryClient.setQueriesData<Coluna>({ queryKey: [...FUNIL, para] }, (coluna) => {
          if (!coluna || coluna.pages.length === 0) return coluna;
          const [primeira, ...resto] = coluna.pages;
          return { ...coluna, pages: [{ ...primeira, data: [card, ...primeira.data], total: primeira.total + 1 }, ...resto] };
        });
      }
      return { antes };
    },
    onError: (_erro, _vars, contexto) => contexto?.antes.forEach(([key, data]) => queryClient.setQueryData(key, data)),
    onSettled: () => {
      // HubSpot's search index lags the write: refetch a bit later, so the card doesn't jump back
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["clientes"] }), 4000);
    },
  });
}
