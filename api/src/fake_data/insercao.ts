import { PoolClient } from "pg";
import { ProdutoFicticio } from "./gerador";

// SQL helpers shared by the fake-data routes and scripts/seed_fake.ts

// multi-row INSERT in chunks; ~10,000 parameters per statement stays far below Postgres' 65,535
export async function inserirEmLotes(client: PoolClient, tabela: string, colunas: string[], linhas: unknown[][], sufixo = "") {
   const porVez = Math.max(1, Math.floor(10_000 / colunas.length));
   for (let i = 0; i < linhas.length; i += porVez) {
      const parte = linhas.slice(i, i + porVez);
      const valores = parte.map((_, r) => `(${colunas.map((_, c) => `$${r * colunas.length + c + 1}`).join(",")})`);
      await client.query(`insert into ${tabela} (${colunas.join(",")}) values ${valores.join(",")} ${sufixo}`, parte.flat());
   }
}

// Dates go to node-pg as Date objects, which it writes in the server's local time: the same as every
// row the app itself writes into these timestamp-without-time-zone columns.

export const linhaProduto = (p: ProdutoFicticio, categoriaId: string) => [
   p.id, p.nome, p.ativo, p.sku, categoriaId, p.custo, p.icms, p.venda, p.cadastro, p.estoque,
];
export const COLUNAS_PRODUTO = [
   "id", "name", "ativo", "sku", "categoria_id", "valor_de_custo", "icms", "valor_de_venda", "data_de_cadastro", "quantidade_em_estoque",
];
