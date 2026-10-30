import { EventEmitter } from "node:events";

// Products changed outside this process's services: an import finished in one of ImportacaoCluster's
// processes, which have their own ProductService and caches. The cluster re-emits it here so the HTTP
// process's first-page caches (products and auditorias, since imports audit the products they update)
// drop their copies instead of serving the pre-import page for as long as the session keeps it alive.

// what an import process sends ImportacaoCluster once an import's products are committed
export const IMPORTACAO_CONCLUIDA = "importacao_concluida";

const eventos = new EventEmitter();
const ALTERADOS = "alterados";

export const avisarProdutosAlterados = () => {
  eventos.emit(ALTERADOS);
};

export const aoAlterarProdutos = (listener: () => void) => {
  eventos.on(ALTERADOS, listener);
};
