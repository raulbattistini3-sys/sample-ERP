// Fake but believable data for demos and load tests: products priced like their category, usuarios with
// Brazilian names, and audit histories that end exactly at each product's current values. The same --seed
// gives the same data. The generator itself is src/fake_data/gerador.ts, shared with the web's
// development-only "Gerar dados fictícios" buttons.
//
//   bun run seed:fake                                  5,000 products, 8 usuarios, audits for 300 products
//   bun run seed:fake --produtos 100000 --auditorias 2000 --usuarios 20 --seed 7
//   bun run seed:fake --remover                        deletes everything this script created
//   bun run seed:fake --planilha produtos.csv --linhas 2000 [--com-erros]
//                                                      a spreadsheet for Produtos > Importar (no database)
//
// The connection follows the API's rules (src/configs/database_connection.ts): verified TLS with
// API_ENV=production or DATABASE_CA_CERT, plain otherwise. Two guards, each lifted only by its own flag:
//   API_ENV=production                          --permitir-producao
//   a host other than localhost or "db"         --permitir-remoto (a development .env can still point
//                                               at a shared or production database)
// Rows it creates are tagged so --remover finds them: SKUs start with "FK-", usuario e-mails end with
// "@demo.local" (password: senha123).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { Pool, PoolClient } from "pg";
import { databaseConnection } from "../src/configs/database_connection";
import {
   DIA, EMAIL_DOMAIN, ICMS_PADRAO, SENHA_DEMO, SKU_PREFIX, centavos, criarGerador, precoDeVitrine,
} from "../src/fake_data/gerador";
import { COLUNAS_PRODUTO, inserirEmLotes, linhaProduto } from "../src/fake_data/insercao";

// ---------------------------------------------------------------- options

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
   const i = args.indexOf(`--${name}`);
   if (i === -1) return fallback;
   const value = Number(args[i + 1]);
   if (!Number.isInteger(value) || value < 0) fail(`--${name} needs a whole number`);
   return value;
};
const text = (name: string) => {
   const i = args.indexOf(`--${name}`);
   return i === -1 ? undefined : args[i + 1];
};

function fail(message: string): never {
   console.error(`[seed:fake] ${message}`);
   process.exit(1);
}

const SEED = option("seed", 42);
const PRODUTOS = option("produtos", 5000);
const USUARIOS = option("usuarios", 8);
const AUDITORIAS = option("auditorias", 300);
const LINHAS = option("linhas", 1000);

const g = criarGerador(SEED);
const agora = Date.now();

// ---------------------------------------------------------------- spreadsheet (no database)

function escreverPlanilha(arquivo: string) {
   const comErros = flag("com-erros");
   const lote = g.lote();
   const dinheiroBr = (v: number) => v.toFixed(2).replace(".", ",");
   const celula = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
   // the importer's column order (importer/importacao/linha.go, web productsImport.ts IMPORT_COLUMNS)
   const linhas = [["SKU", "Nome", "Categoria", "Valor de custo (R$)", "ICMS (%)", "Valor de venda (R$)", "Estoque"]];
   const erros: string[] = [];
   for (let i = 1; i <= LINHAS; i++) {
      const p = g.produto(i, lote, "PL-", agora);
      const linha = [p.sku, p.nome, p.categoria, dinheiroBr(p.custo), String(p.icms).replace(".", ","), dinheiroBr(p.venda), String(p.estoque)];
      // about 2% of the rows break one rule each, to show the import's validation
      if (comErros && g.chance(0.02)) {
         const tipo = g.int(0, 4);
         if (tipo === 0) linha[0] = "";
         if (tipo === 1) linha[2] = "BRINQUEDOS";
         if (tipo === 2) linha[3] = "-" + linha[3];
         if (tipo === 3) linha[6] = "12,5";
         if (tipo === 4 && i > 2) linha[0] = linhas[1][0];
         erros.push(`linha ${i + 1}: ${["SKU vazio", "categoria inexistente", "custo negativo", "estoque fracionado", "SKU repetido"][tipo]}`);
      }
      linhas.push(linha);
   }
   // ; and decimal commas, with a BOM: how Excel in pt-BR writes and opens CSV
   const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
   const caminho = resolve(arquivo);
   writeFileSync(caminho, csv, "utf8");
   console.log(`${LINHAS} products written to ${caminho}`);
   if (erros.length) console.log(`${erros.length} invalid rows on purpose:\n  ${erros.join("\n  ")}`);
}

// ---------------------------------------------------------------- database

const OBSERVACOES_MANUAIS = [
   "Conferência de inventário mensal.",
   "Ajuste após contagem física no depósito.",
   "Produto recebido do fornecedor com nota fiscal conferida.",
   "Reajuste de preço conforme tabela do fornecedor.",
   "Correção de cadastro solicitada pelo setor comercial.",
   "Promoção sazonal aprovada pela gerência.",
   "Revisão de margem do trimestre.",
];
const dinheiro = (v: number) => v.toFixed(2).replace(".", ","); // like the API's diff: 4090.5 -> "4090,50"

async function semear(client: PoolClient) {
   const { rows: cats } = await client.query<{ id: string; nome: string }>("select id, nome::text as nome from categorias");
   const categoriaId = new Map(cats.map((c) => [c.nome, c.id]));
   await client.query("begin");

   // usuarios
   const hash = await bcrypt.hash(SENHA_DEMO, 10); // one hash for all: they share the demo password
   const usuarios = Array.from({ length: USUARIOS }, (_, i) => {
      const u = g.usuario(i + 1, `s${SEED}`);
      return [randomUUID(), u.nome, u.permissoes, u.email, hash, u.ativo];
   });
   await inserirEmLotes(client, "usuarios", ["id", "nome", "permissoes", "email", "senha", "ativo"], usuarios, "on conflict do nothing");
   const { rows: auditores } = await client.query<{ id: string }>("select id from usuarios where ativo");
   if (auditores.length === 0 && AUDITORIAS > 0) fail("no active usuario to sign the auditorias; use --usuarios 1 or more");

   // produtos, only in the categorias the database has
   const lote = g.lote();
   const produtos = [];
   for (let seq = 1; produtos.length < PRODUTOS && seq < PRODUTOS * 20 + 20; seq++) {
      const p = g.produto(seq, lote, SKU_PREFIX, agora);
      if (categoriaId.has(p.categoria)) produtos.push(p);
   }
   if (PRODUTOS > 0 && produtos.length === 0) fail("the database has no categorias (run docker/postgres/init or the Categorias button)");
   await inserirEmLotes(client, "produtos", COLUNAS_PRODUTO, produtos.map((p) => linhaProduto(p, categoriaId.get(p.categoria)!)));

   // auditorias: walking back from each product's current values, so the newest change ends exactly
   // where the product is now
   const detalhes: unknown[][] = [];
   const auditorias: unknown[][] = [];
   const vinculos: unknown[][] = [];
   for (const produto of produtos.slice(0, Math.min(AUDITORIAS, produtos.length))) {
      let atual = { custo: produto.custo, icms: produto.icms, venda: produto.venda, estoque: produto.estoque };
      let quando = new Date(agora - g.between(0, 20) * DIA);
      for (let k = g.int(1, 3); k > 0 && quando > produto.cadastro; k--) {
         const manual = g.chance(0.15);
         const antes = { ...atual };
         const campos: { campo: string; antes: string; depois: string }[] = [];
         if (!manual) {
            if (g.chance(0.6)) antes.venda = precoDeVitrine(atual.venda * g.between(0.85, 1.12));
            if (g.chance(0.3)) antes.custo = centavos(atual.custo * g.between(0.88, 1.08));
            if (g.chance(0.35)) antes.estoque = Math.max(0, atual.estoque + g.int(-40, 60));
            if (g.chance(0.08)) antes.icms = g.weighted(ICMS_PADRAO);
            if (antes.venda === atual.venda && antes.custo === atual.custo && antes.estoque === atual.estoque && antes.icms === atual.icms) {
               antes.venda = precoDeVitrine(atual.venda * 1.05);
            }
            const add = (campo: string, a: string, d: string) => a !== d && campos.push({ campo, antes: a, depois: d });
            add("Valor de custo", dinheiro(antes.custo), dinheiro(atual.custo));
            add("ICMS", String(antes.icms), String(atual.icms));
            add("Valor de venda", dinheiro(antes.venda), dinheiro(atual.venda));
            add("Estoque", String(antes.estoque), String(atual.estoque));
         }
         const detalheId = randomUUID();
         const auditoriaId = randomUUID();
         const observacoes = manual
            ? g.pick(OBSERVACOES_MANUAIS)
            : "Alteração registrada automaticamente. " + campos.map((c) => `${c.campo}: ${c.antes} → ${c.depois}`).join("; ");
         detalhes.push([detalheId, produto.nome, antes.venda, atual.venda, observacoes, JSON.stringify(campos)]);
         auditorias.push([auditoriaId, "Alteracao", quando, g.pick(auditores).id, detalheId, quando.toISOString(), quando.toISOString()]);
         vinculos.push([auditoriaId, produto.id]);
         atual = antes;
         quando = new Date(quando.getTime() - g.between(2, 90) * DIA);
      }
      // the product's first auditoria: its creation
      const detalheId = randomUUID();
      const auditoriaId = randomUUID();
      detalhes.push([detalheId, produto.nome, 0, atual.venda, "Cadastro inicial do produto.", "[]"]);
      auditorias.push([auditoriaId, "Criacao", produto.cadastro, g.pick(auditores).id, detalheId, produto.cadastro.toISOString(), produto.cadastro.toISOString()]);
      vinculos.push([auditoriaId, produto.id]);
   }
   await inserirEmLotes(client, "detalhamentos_auditoria",
      ["id", "nome_do_produto", "valor_anterior", "valor_atual", "observacoes_adicionais", "alteracoes"], detalhes);
   await inserirEmLotes(client, "auditorias",
      ["id", "acao_efetuada", "data_de_audicao", "usuario_id", "detalhamento_auditoria_id", "criada_em", "vinculada_em"], auditorias);
   await inserirEmLotes(client, "produtos_por_auditoria", ["auditoria_id", "produto_id"], vinculos);

   await client.query("commit");
   console.log(`created ${usuarios.length} usuarios (password ${SENHA_DEMO}), ${produtos.length} produtos, ${auditorias.length} auditorias (seed ${SEED})`);
}

async function remover(client: PoolClient) {
   await client.query("begin");
   // auditorias of fake products, and any left signed by fake usuarios
   const { rows } = await client.query<{ id: string; detalhe: string | null }>(
      `select distinct a.id, a.detalhamento_auditoria_id as detalhe
         from auditorias a
         left join produtos_por_auditoria pa on pa.auditoria_id = a.id
         left join produtos p on p.id = pa.produto_id
         left join usuarios u on u.id = a.usuario_id
        where p.sku like $1 or u.email like $2`,
      [`${SKU_PREFIX}%`, `%${EMAIL_DOMAIN}`],
   );
   const ids = rows.map((r) => r.id);
   const detalhes = rows.map((r) => r.detalhe).filter(Boolean);
   // auditoria_integracao_envios rows go with their auditoria (ON DELETE CASCADE)
   await client.query("delete from produtos_por_auditoria where auditoria_id = any($1::uuid[])", [ids]);
   await client.query("delete from auditorias where id = any($1::uuid[])", [ids]);
   await client.query("delete from detalhamentos_auditoria where id = any($1::uuid[])", [detalhes]);
   // a fake product may also sit in a real auditoria's links
   await client.query("delete from produtos_por_auditoria where produto_id in (select id from produtos where sku like $1)", [`${SKU_PREFIX}%`]);
   const produtos = await client.query("delete from produtos where sku like $1", [`${SKU_PREFIX}%`]);
   const usuarios = await client.query("delete from usuarios where email like $1", [`%${EMAIL_DOMAIN}`]);
   await client.query("commit");
   console.log(`removed ${produtos.rowCount} produtos, ${ids.length} auditorias, ${usuarios.rowCount} usuarios`);
}

// ---------------------------------------------------------------- main

const planilha = text("planilha");
if (planilha) {
   escreverPlanilha(planilha);
   process.exit(0);
}

const conexao = databaseConnection(); // exits when API_ENV, DATABASE_URL or the CA is wrong
if (conexao.apiEnv === "production" && !flag("permitir-producao")) {
   fail("API_ENV=production: pass --permitir-producao to really write fake data to that database");
}
const host = new URL(conexao.connectionString).hostname;
if (!["localhost", "127.0.0.1", "[::1]", "::1", "db"].includes(host) && !flag("permitir-remoto")) {
   fail(`DATABASE_URL points at ${host}, not a local database; pass --permitir-remoto if that's really intended`);
}
console.log(`connecting to ${host} ${conexao.ssl ? "with verified TLS" : "without TLS"} (API_ENV=${conexao.apiEnv})`);

const pool = new Pool({ connectionString: conexao.connectionString, ssl: conexao.ssl, max: 1 });
const inicio = performance.now();
const client = await pool.connect().catch((error: Error) => fail(`could not connect: ${error.message}`));
try {
   await (flag("remover") ? remover(client) : semear(client));
   console.log(`done in ${((performance.now() - inicio) / 1000).toFixed(1)}s`);
} catch (error) {
   await client.query("rollback").catch(() => {});
   console.error(error);
   process.exitCode = 1;
} finally {
   client.release();
   await pool.end();
}
