import { randomUUID } from "node:crypto";

// Fake but believable rows, shared by scripts/seed_fake.ts and the development-only /dev/fake-data
// routes. Products are priced like their category (a 500 g coffee costs R$ 18-45, not R$ 8,000), names
// read like listings without real trademarks, and the same seed gives the same data.

export const SKU_PREFIX = "FK-";
export const EMAIL_DOMAIN = "@demo.local";
export const SENHA_DEMO = "senha123";

type Item = readonly [nome: string, custoMin: number, custoMax: number];
type Categoria = { itens: readonly Item[]; markup: readonly [number, number]; prefixo: string; tipo: "Normal" | "Especial" };

// cost ranges in R$ (what the store pays); the sale price comes from the category's markup
export const CATALOGO: Record<string, Categoria> = {
   INFORMATICA: {
      prefixo: "INF", tipo: "Normal", markup: [1.18, 1.55],
      itens: [
         ["Notebook", 2400, 8200], ["Monitor 24\"", 520, 1500], ["Mouse sem fio", 30, 190], ["Teclado mecânico", 140, 560],
         ["SSD 1TB", 260, 760], ["Memória RAM 16GB", 150, 420], ["Webcam Full HD", 90, 380], ["Headset gamer", 110, 650],
         ["Roteador Wi-Fi 6", 200, 980], ["Impressora multifuncional", 480, 1900],
      ],
   },
   CELULARES: {
      prefixo: "CEL", tipo: "Normal", markup: [1.2, 1.6],
      itens: [
         ["Smartphone", 750, 6400], ["Capa protetora", 12, 70], ["Película de vidro", 6, 30], ["Carregador turbo", 40, 180],
         ["Cabo USB-C", 12, 60], ["Fone Bluetooth", 60, 950], ["Power bank 10000mAh", 60, 260], ["Smartwatch", 190, 2900],
         ["Suporte veicular", 18, 110],
      ],
   },
   ELETRONICOS: {
      prefixo: "ELT", tipo: "Normal", markup: [1.2, 1.5],
      itens: [
         ["Smart TV 50\"", 1900, 4700], ["Caixa de som Bluetooth", 110, 1250], ["Soundbar", 480, 2900], ["Fone over-ear", 150, 2100],
         ["Console de videogame", 2200, 4200], ["Câmera de ação", 560, 2700], ["Projetor", 650, 3800], ["Tablet", 750, 5100],
      ],
   },
   ELETRODOMESTICOS: {
      prefixo: "EDM", tipo: "Normal", markup: [1.25, 1.6],
      itens: [
         ["Geladeira frost free", 2200, 7400], ["Micro-ondas", 410, 1150], ["Air fryer", 230, 740], ["Liquidificador", 90, 360],
         ["Máquina de lavar", 1500, 3900], ["Aspirador de pó", 190, 1250], ["Cafeteira", 90, 760], ["Lava-louças", 1900, 4300],
         ["Ventilador de coluna", 90, 400], ["Ferro de passar", 60, 290],
      ],
   },
   CASA: {
      prefixo: "CSA", tipo: "Normal", markup: [1.5, 2.2],
      itens: [
         ["Jogo de cama casal", 70, 380], ["Toalha de banho", 18, 95], ["Luminária de mesa", 50, 290], ["Panela antiaderente", 55, 320],
         ["Jogo de copos", 22, 110], ["Caixa organizadora", 14, 75], ["Tapete", 55, 560], ["Cortina blackout", 55, 250],
      ],
   },
   MERCADO: {
      prefixo: "MER", tipo: "Normal", markup: [1.12, 1.4],
      itens: [
         ["Arroz tipo 1 5kg", 18, 31], ["Feijão carioca 1kg", 5.5, 9.5], ["Azeite extra virgem 500ml", 24, 58], ["Café torrado 500g", 14, 36],
         ["Açúcar refinado 1kg", 3.2, 6.2], ["Leite integral 1L", 3.6, 6.2], ["Macarrão espaguete 500g", 3, 9], ["Óleo de soja 900ml", 4.8, 9.5],
         ["Biscoito recheado", 2.2, 6.5], ["Sabão em pó 1,6kg", 14, 36],
      ],
   },
   MODA: {
      prefixo: "MOD", tipo: "Especial", markup: [1.8, 2.6],
      itens: [
         ["Camiseta básica", 18, 70], ["Calça jeans", 45, 170], ["Tênis casual", 75, 340], ["Jaqueta corta-vento", 90, 430],
         ["Vestido midi", 45, 220], ["Bermuda", 30, 110], ["Boné", 18, 85], ["Kit 3 pares de meia", 12, 38],
      ],
   },
   "COMERCIO & SEGURANCA": {
      prefixo: "SEG", tipo: "Especial", markup: [1.3, 1.8],
      itens: [
         ["Câmera de segurança Wi-Fi", 110, 520], ["Alarme residencial", 220, 1100], ["Fechadura digital", 290, 1650],
         ["Cofre eletrônico", 260, 1900], ["Leitor de código de barras", 130, 680], ["Impressora térmica", 290, 1150],
         ["Sensor de presença", 28, 130], ["Kit DVR 4 câmeras", 520, 1900],
      ],
   },
   "LAZER E ENTRETENIMENTO": {
      prefixo: "LAZ", tipo: "Normal", markup: [1.35, 1.9],
      itens: [
         ["Jogo de tabuleiro", 55, 320], ["Quebra-cabeça 1000 peças", 34, 120], ["Violão", 260, 1900], ["Livro", 22, 85],
         ["Controle sem fio", 190, 420], ["Drone", 300, 4600], ["Barraca de camping", 150, 1100], ["Cadeira de praia", 42, 180],
      ],
   },
   "ESPORTE E SAUDE": {
      prefixo: "ESP", tipo: "Normal", markup: [1.35, 1.85],
      itens: [
         ["Bicicleta aro 29", 850, 4600], ["Par de halteres", 42, 300], ["Tapete de yoga", 34, 180], ["Esteira elétrica", 1400, 5300],
         ["Garrafa térmica", 28, 130], ["Bola de futebol", 42, 220], ["Balança digital", 34, 180], ["Monitor cardíaco", 110, 1150],
      ],
   },
};

// fictional brands and lines, so names read like real listings without using real trademarks
const MARCAS = ["Voltex", "Nimbus", "Aurora", "Kairo", "Tessa", "Brisa", "Orion", "Lumi", "Vértice", "Solaris", "Ipê", "Maré"];
const SERIES = ["Basic", "Plus", "Pro", "Max", "Lite", "Slim", "Prime", "Ultra", "Eco", "Smart", "One", "X"];
const NOMES = ["Ana", "Bruno", "Camila", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Larissa", "Lucas",
   "Mariana", "Matheus", "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Thiago", "Vitória", "Gustavo", "Beatriz", "Leonardo"];
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento",
   "Carvalho", "Ribeiro", "Gomes", "Martins", "Araújo", "Barbosa", "Rocha", "Dias", "Moreira", "Cardoso"];

// common ICMS rates; staples get the reduced ones more often
export const ICMS_PADRAO = [[18, 35], [17, 10], [19, 10], [20.5, 8], [12, 15], [7, 10], [4, 7], [0, 5]] as const;
const ICMS_MERCADO = [[7, 30], [12, 25], [18, 25], [0, 20]] as const;

export type ProdutoFicticio = {
   id: string;
   nome: string;
   sku: string;
   categoria: string;
   custo: number;
   icms: number;
   venda: number;
   estoque: number;
   ativo: boolean;
   cadastro: Date;
};

export type UsuarioFicticio = { nome: string; email: string; permissoes: "Estoque" | "ADM"; ativo: boolean };

export const DIA = 86_400_000;
export const centavos = (v: number) => Math.round(v * 100) / 100;
// retail-looking prices: R$ 1.234,90 / R$ 18,90
export const precoDeVitrine = (v: number) => (v < 10 ? centavos(v) : Math.floor(v) + 0.9);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function criarGerador(seed = Math.floor(Math.random() * 2 ** 31)) {
   // mulberry32: tiny, fast and good enough for fake data
   let state = seed >>> 0 || 1;
   const rand = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
   };
   const between = (min: number, max: number) => min + rand() * (max - min);
   const int = (min: number, max: number) => Math.floor(between(min, max + 1));
   const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
   const chance = (p: number) => rand() < p;
   const weighted = <T>(pairs: readonly (readonly [T, number])[]): T => {
      const total = pairs.reduce((sum, [, w]) => sum + w, 0);
      let r = rand() * total;
      for (const [value, w] of pairs) if ((r -= w) < 0) return value;
      return pairs[pairs.length - 1][0];
   };
   // spread evenly in orders of magnitude, so a R$ 40-250 item is as often R$ 50 as R$ 200
   const logBetween = (min: number, max: number) => Math.exp(between(Math.log(min), Math.log(max)));
   // 4 characters that tell one run's SKUs from another's
   const lote = () => Array.from({ length: 4 }, () => pick("ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""))).join("");

   const produto = (seq: number, loteId: string, prefixoSku = SKU_PREFIX, agora = Date.now()): ProdutoFicticio => {
      const categoria = pick(Object.keys(CATALOGO));
      const { itens, markup, prefixo } = CATALOGO[categoria];
      const [item, custoMin, custoMax] = pick(itens);
      const custo = centavos(logBetween(custoMin, custoMax));
      const venda = Math.max(centavos(custo * 1.05), precoDeVitrine(custo * between(...markup)));
      // cheaper items sit in larger quantities; a few are out of stock
      const teto = venda < 50 ? 2500 : venda < 500 ? 500 : venda < 3000 ? 120 : 35;
      return {
         id: randomUUID(),
         nome: `${item} ${pick(MARCAS)} ${pick(SERIES)}`,
         sku: `${prefixoSku}${prefixo}-${loteId}-${String(seq).padStart(6, "0")}`,
         categoria,
         custo,
         icms: weighted(categoria === "MERCADO" ? ICMS_MERCADO : ICMS_PADRAO),
         venda,
         estoque: chance(0.04) ? 0 : Math.max(1, Math.round(logBetween(1, teto))),
         ativo: chance(0.96),
         cadastro: new Date(agora - between(0, 540) * DIA),
      };
   };

   // the tag keeps e-mails unique across runs (seed + position)
   const usuario = (i: number, tag: string): UsuarioFicticio => {
      const nome = `${pick(NOMES)} ${pick(SOBRENOMES)}`;
      const [primeiro, ultimo] = semAcento(nome).split(" ");
      return {
         nome,
         email: `${primeiro}.${ultimo}.${tag}${i}${EMAIL_DOMAIN}`,
         permissoes: weighted([["Estoque", 85], ["ADM", 15]] as const),
         ativo: chance(0.9),
      };
   };

   return { seed, rand, between, int, pick, chance, weighted, logBetween, lote, produto, usuario };
}

export type Gerador = ReturnType<typeof criarGerador>;
