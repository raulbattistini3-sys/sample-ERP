import { randomUUID } from "node:crypto";
import { Pool, PoolClient } from "pg";
import { COLUNAS_PRODUTO, inserirEmLotes, linhaProduto } from "./insercao";
import ProductService from "../services/product.service";
import ProductRepository from "../repositories/product.repository";
import { avisarProdutosAlterados } from "../utils/cache/produtos_alterados";
import { hashPassword } from "../utils/helpers/password.util";
import { CATALOGO, ProdutoFicticio, SENHA_DEMO, criarGerador, precoDeVitrine } from "./gerador";

// What the development-only "Gerar dados fictícios" buttons do (routes/fake_data.routes.ts). Produtos,
// usuarios and categorias are inserted directly; auditorias go through ProductService like a real edit.
class FakeDataService {
   constructor(
      private readonly pool: Pool,
      private readonly productService: ProductService,
      private readonly productRepository: ProductRepository,
   ) {}

   private async categoriaIds(client: PoolClient) {
      const { rows } = await client.query<{ id: string; nome: string }>(
         "select id, nome::text as nome from categorias where ativo",
      );
      return new Map(rows.map((c) => [c.nome, c.id]));
   }

   async produtos(quantidade: number) {
      const gerador = criarGerador();
      const client = await this.pool.connect();
      try {
         const ids = await this.categoriaIds(client);
         const lote = gerador.lote();
         const produtos: ProdutoFicticio[] = [];
         // only categorias that exist and are active; the generator picks from all ten
         for (let seq = 1; produtos.length < quantidade && seq < quantidade * 20; seq++) {
            const p = gerador.produto(seq, lote);
            if (ids.has(p.categoria)) produtos.push(p);
         }
         if (produtos.length === 0) {
            return { criados: 0, motivo: "Nenhuma categoria ativa: gere ou ative categorias primeiro." };
         }
         await client.query("begin");
         await inserirEmLotes(client, "produtos", COLUNAS_PRODUTO, produtos.map((p) => linhaProduto(p, ids.get(p.categoria)!)));
         await client.query("commit");
         avisarProdutosAlterados(); // the cached first page of the product list
         return { criados: produtos.length, lote };
      } catch (error) {
         await client.query("rollback").catch(() => {});
         throw error;
      } finally {
         client.release();
      }
   }

   async usuarios(quantidade: number) {
      const gerador = criarGerador();
      const hash = await hashPassword(SENHA_DEMO); // one hash: they all share the demo password
      const tag = gerador.lote().toLowerCase();
      const linhas = Array.from({ length: quantidade }, (_, i) => {
         const u = gerador.usuario(i + 1, tag);
         return [randomUUID(), u.nome, u.permissoes, u.email, hash, u.ativo];
      });
      const client = await this.pool.connect();
      try {
         await inserirEmLotes(client, "usuarios", ["id", "nome", "permissoes", "email", "senha", "ativo"], linhas, "on conflict do nothing");
         return { criados: linhas.length, senha: SENHA_DEMO };
      } finally {
         client.release();
      }
   }

   // categoria names are a fixed enum of ten, so "new" categorias can only be the ones missing
   async categorias() {
      const client = await this.pool.connect();
      try {
         const { rows } = await client.query<{ nome: string }>("select distinct nome::text as nome from categorias");
         const existentes = new Set(rows.map((r) => r.nome));
         const faltando = Object.keys(CATALOGO).filter((nome) => !existentes.has(nome));
         if (faltando.length > 0) {
            await inserirEmLotes(client, "categorias", ["nome", "tipo", "ativo"], faltando.map((nome) => [nome, CATALOGO[nome].tipo, true]));
         }
         return {
            criadas: faltando,
            motivo: faltando.length === 0 ? "As 10 categorias já existem; os nomes são fixos (enum categorias_nomes)." : undefined,
         };
      } finally {
         client.release();
      }
   }

   // A check test of the audit trail: each picked product gets its sale price changed and then put back,
   // both through ProductService.updateProduct as this usuario. That writes two automatic "Alteracao"
   // auditorias per product (and queues them for connected integrations, like any real edit), and leaves
   // the product exactly as it was.
   async auditorias(quantidade: number, usuarioId: string) {
      const gerador = criarGerador();
      const { rows } = await this.pool.query<{ id: string }>(
         "select id from produtos where ativo order by random() limit $1",
         [quantidade],
      );
      let produtos = 0;
      const falhas: string[] = [];
      for (const { id } of rows) {
         const atual = await this.productRepository.getProductById(id, true);
         if (atual.isLeft()) {
            falhas.push(`${id}: ${atual.value.message}`);
            continue;
         }
         const { produto, categoria } = atual.value;
         const original = {
            id,
            name: produto.name,
            sku: produto.sku,
            categoria: { nome: categoria.nome },
            valor_de_custo: Number(produto.valorDeCusto),
            icms: Number(produto.icms),
            valor_de_venda: Number(produto.valorDeVenda),
            quantidade_em_estoque: Number(produto.quantidadeEmEstoque),
            ativo: produto.ativo,
         };
         let novaVenda = precoDeVitrine(original.valor_de_venda * gerador.between(1.03, 1.15));
         if (novaVenda === original.valor_de_venda) novaVenda += 1;

         const alterado = await this.productService.updateProduct({ ...original, valor_de_venda: novaVenda }, usuarioId, true);
         if (alterado.isLeft()) {
            falhas.push(`${produto.name}: ${alterado.value.message}`);
            continue;
         }
         const restaurado = await this.productService.updateProduct(original, usuarioId, true);
         if (restaurado.isLeft()) {
            falhas.push(`${produto.name}: changed but not restored (${restaurado.value.message})`);
            continue;
         }
         produtos++;
      }
      return { produtos, auditorias: produtos * 2, falhas };
   }
}

export default FakeDataService;
