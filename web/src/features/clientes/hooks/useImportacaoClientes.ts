import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSingleFlightMutation } from "../../../hooks/useSingleFlightMutation";
import {
  ErroImportacaoClientes,
  getErrosImportacaoClientes,
  getImportacaoClientes,
  importacaoClientesTerminou,
  iniciarImportacaoClientes,
  TipoImportacao,
} from "../api/clientes.api";

const POLL_MS = 1500;
const PAGINA = 500;
// the CSV download pulls the rest in the API's largest pages
const PAGINA_DOWNLOAD = 5000;
// the last import of each tipo started in this browser, so closing the modal (or reloading) doesn't lose its progress
const ULTIMA_KEY: Record<TipoImportacao, string> = {
  clientes: "clientes:ultima-importacao",
  empresas: "empresas:ultima-importacao",
};

export const lembrarImportacao = (tipo: TipoImportacao) => ({
  ler: () => {
    try {
      return localStorage.getItem(ULTIMA_KEY[tipo]);
    } catch {
      return null;
    }
  },
  gravar: (id: string | null) => {
    try {
      if (id) localStorage.setItem(ULTIMA_KEY[tipo], id);
      else localStorage.removeItem(ULTIMA_KEY[tipo]);
    } catch {
      // private window: only this session remembers it
    }
  },
});

export const useIniciarImportacaoClientes = (tipo: TipoImportacao = "clientes") =>
  useSingleFlightMutation({ mutationFn: (arquivo: File) => iniciarImportacaoClientes(arquivo, tipo) });

// polls until concluida, rejeitada or falhou; the end refreshes the client and company lists
export const useImportacaoClientes = (id: string | null, tipo: TipoImportacao = "clientes") => {
  const queryClient = useQueryClient();
  return useQuery({
    // outside ["clientes"], so invalidating the lists doesn't refetch this
    queryKey: ["clientes-importacoes", tipo, id],
    queryFn: async () => {
      const importacao = await getImportacaoClientes(id!, tipo);
      if (importacao.status === "concluida") queryClient.invalidateQueries({ queryKey: ["clientes"] });
      return importacao;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && importacaoClientesTerminou(status) ? false : POLL_MS;
    },
  });
};

// Failed rows, cached per import for as long as the page is open: what was fetched (a, b) stays, and each
// request asks only for the rows after the last seq it has (c). Reopening the modal or a poll that brings
// more failures never fetches the same rows twice.
type Cache = { erros: ErroImportacaoClientes[]; ultimo: number };
const caches = new Map<string, Cache>();
const cacheDe = (id: string) => {
  let cache = caches.get(id);
  if (!cache) {
    cache = { erros: [], ultimo: 0 };
    caches.set(id, cache);
  }
  return cache;
};

const buscarDepois = async (id: string, cache: Cache, limite: number, tipo: TipoImportacao) => {
  const pagina = await getErrosImportacaoClientes(id, cache.ultimo, limite, tipo);
  // a stale response that overlaps what another call already appended
  const novos = pagina.data.filter((e) => e.seq > cache.ultimo);
  if (novos.length > 0) {
    cache.erros.push(...novos);
    cache.ultimo = novos[novos.length - 1].seq;
  }
  return novos.length;
};

// `falharam` is the import's linhas_falharam: when it is ahead of the cache, there's something new to fetch.
// Only the first `mostrar` rows are kept on screen (500 at a time); the CSV has them all.
export const useErrosImportacaoClientes = (id: string | null, falharam: number, tipo: TipoImportacao = "clientes") => {
  const [mostrar, setMostrar] = useState(PAGINA);
  const [erros, setErros] = useState<ErroImportacaoClientes[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const ocupado = useRef(false);

  useEffect(() => {
    setMostrar(PAGINA);
    setErro(null);
    setErros(id ? cacheDe(id).erros.slice(0, PAGINA) : []);
  }, [id]);

  useEffect(() => {
    if (!id || ocupado.current) return;
    const cache = cacheDe(id);
    const alvo = Math.min(falharam, mostrar);
    if (cache.erros.length >= alvo) {
      setErros(cache.erros.slice(0, mostrar));
      return;
    }
    ocupado.current = true;
    setCarregando(true);
    buscarDepois(id, cache, Math.min(PAGINA, alvo - cache.erros.length), tipo)
      .then(() => setErro(null))
      .catch(setErro)
      .finally(() => {
        ocupado.current = false;
        setCarregando(false);
        setErros(cache.erros.slice(0, mostrar));
      });
    // erros changes after each fetch, which re-runs this until the cache reaches the target
  }, [id, falharam, mostrar, erros.length, tipo]);

  const mostrarMais = useCallback(() => setMostrar((m) => m + PAGINA), []);

  // every failed row, for the CSV: what's cached plus the rest, fetched after the last seq
  const todos = useCallback(async () => {
    if (!id) return [];
    const cache = cacheDe(id);
    while (cache.erros.length < falharam) {
      if ((await buscarDepois(id, cache, PAGINA_DOWNLOAD, tipo)) === 0) break;
    }
    return cache.erros;
  }, [id, falharam, tipo]);

  return { erros, total: falharam, carregando, erro, temMais: erros.length < falharam, mostrarMais, todos };
};
