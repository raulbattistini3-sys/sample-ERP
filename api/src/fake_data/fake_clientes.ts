import type HubspotService from "../services/hubspot.service";
import type ClienteService from "../services/cliente.service";
import { criarGerador } from "./gerador";

// "Gerar dados fictícios" on Clientes (dev only, like every /dev/fake-data route). Clientes live in
// HubSpot, never in the database, so these are written to the connected HubSpot portal: use a
// developer/sandbox portal. Everything made here is marked so it can be found and removed there:
// companies end in "(demo)", contacts' e-mails end in @clientes.demo.local.

const RAMOS = ["Comercial", "Distribuidora", "Indústria", "Serviços", "Tecnologia", "Logística", "Alimentos", "Construtora"];
const SUFIXOS = ["Ltda", "S.A.", "ME", "EIRELI"];
const CARGOS: readonly (readonly [string, string])[] = [
   ["Diretor de Compras", "director"],
   ["Gerente Comercial", "manager"],
   ["Analista de Compras", "employee"],
   ["Sócio", "partner"],
   ["Coordenador Financeiro", "manager"],
   ["Assistente Administrativo", "entry"],
   ["CEO", "executive"],
];
const EMAIL_CLIENTES = "@clientes.demo.local";
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function gerarClientes(hubspot: HubspotService, clientes: ClienteService, quantidade: number) {
   const g = criarGerador();
   const tag = g.lote().toLowerCase();

   // about 4 clientes per company
   const empresas: { id: string; nome: string }[] = [];
   for (let i = 0; i < Math.max(1, Math.ceil(quantidade / 4)); i++) {
      const marca = g.produto(i, tag).nome.split(" ")[1];
      const nome = `${marca} ${g.pick(RAMOS)} ${g.pick(SUFIXOS)} ${tag.toUpperCase()}${i} (demo)`;
      const criada = await hubspot.createCompany({ name: nome, domain: `${semAcento(marca)}-${tag}${i}.demo.local`, city: "São Paulo", state: "SP", country: "Brasil" });
      if (criada.isLeft()) {
         if (!empresas.length) throw criada.value;
         break;
      }
      empresas.push({ id: criada.value.id, nome });
      clientes.lembrarEmpresa(criada.value);
   }

   const entradas = Array.from({ length: quantidade }, (_, i) => {
      const u = g.usuario(i, tag);
      const [primeiro, ...resto] = u.nome.split(" ");
      const empresa = empresas[i % empresas.length];
      const [cargo] = g.pick(CARGOS);
      return {
         email: u.email.replace("@demo.local", EMAIL_CLIENTES),
         empresa,
         properties: {
            firstname: primeiro,
            lastname: resto.join(" "),
            phone: `+55 11 9${g.int(1000, 9999)}-${g.int(1000, 9999)}`,
            company: empresa.nome,
            jobtitle: cargo,
            hs_buying_role: g.chance(0.25) ? "DECISION_MAKER" : null,
         },
      };
   });
   const salvos = await hubspot.upsertContactsByEmail(entradas.map(({ email, properties }) => ({ email, properties: { ...properties, email } })));
   if (salvos.isLeft()) throw salvos.value;

   const porEmail = new Map(entradas.map((e) => [e.email, e.empresa.id]));
   const pares = salvos.value
      .map((c) => ({ contactId: c.id, companyId: porEmail.get(String(c.properties?.email ?? "").toLowerCase()) ?? "" }))
      .filter((p) => p.companyId);
   const ligados = await hubspot.linkContactsToCompanies(pares);
   if (ligados.isLeft()) throw ligados.value;
   clientes.limparCaches();

   return { clientes: salvos.value.length, empresas: empresas.length, lote: tag };
}
