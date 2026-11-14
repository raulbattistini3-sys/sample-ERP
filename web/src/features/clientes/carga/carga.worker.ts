// The Clientes/Empresas page decoder: gets a response body (its ArrayBuffer is transferred, so handing it
// over costs nothing), decodes and parses it off the main thread and posts the object back. The main
// thread then pays only for receiving it (structured clone), which cargaAdaptativa measures.
type Pedido = { id: number; corpo: ArrayBuffer };

const decoder = new TextDecoder();

self.onmessage = (event: MessageEvent<Pedido>) => {
  const { id, corpo } = event.data;
  const t0 = performance.now();
  try {
    const dados: unknown = JSON.parse(decoder.decode(corpo));
    self.postMessage({ id, dados, parseMs: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, erro: err instanceof Error ? err.message : String(err) });
  }
};
