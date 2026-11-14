// What this API wrote to HubSpot in the last couple of minutes. HubSpot's search index trails its writes by
// a few seconds (a new company isn't found yet, a contact just linked still has no associatedcompanyid), so
// the lists read right after a save would show the old state; they lay these entries over what search says.
// In memory and per process: it only bridges that gap, HubSpot stays the source of truth.
class EscritasRecentes<T> {
  private readonly itens = new Map<string, { valor: T; ate: number }>();

  constructor(
    private readonly ttlMs = 2 * 60 * 1000,
    private readonly maximo = 500,
  ) {}

  gravar(id: string, valor: T) {
    this.itens.delete(id);
    this.itens.set(id, { valor, ate: Date.now() + this.ttlMs });
    // oldest first in a Map: past the cap, the oldest go
    while (this.itens.size > this.maximo) this.itens.delete(this.itens.keys().next().value!);
  }

  ler(id: string): T | undefined {
    const item = this.itens.get(id);
    if (!item) return undefined;
    if (item.ate < Date.now()) {
      this.itens.delete(id);
      return undefined;
    }
    return item.valor;
  }

  // newest first
  todos(): T[] {
    const agora = Date.now();
    const vivos: T[] = [];
    for (const [id, item] of this.itens) {
      if (item.ate < agora) this.itens.delete(id);
      else vivos.push(item.valor);
    }
    return vivos.reverse();
  }
}

export default EscritasRecentes;
