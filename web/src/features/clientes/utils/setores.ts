// HubSpot keeps a company's industry as an enum value (COMPUTER_SOFTWARE, FINANCIAL_SERVICES...). Shown here
// in Portuguese for the common ones; any other uses HubSpot's own label when it was loaded (GET
// /clientes/empresas/setores), else the value turned into words ("MARITIME" → "Maritime").
const SETORES: Record<string, string> = {
  ACCOUNTING: "Contabilidade",
  AIRLINES_AVIATION: "Aviação",
  APPAREL_FASHION: "Moda e vestuário",
  ARCHITECTURE_PLANNING: "Arquitetura e urbanismo",
  AUTOMOTIVE: "Automotivo",
  BANKING: "Bancos",
  BIOTECHNOLOGY: "Biotecnologia",
  BROADCAST_MEDIA: "Rádio e TV",
  BUILDING_MATERIALS: "Materiais de construção",
  CHEMICALS: "Química",
  CIVIL_ENGINEERING: "Engenharia civil",
  COMPUTER_HARDWARE: "Hardware",
  COMPUTER_NETWORK_SECURITY: "Segurança da informação",
  COMPUTER_SOFTWARE: "Software",
  CONSTRUCTION: "Construção",
  CONSUMER_ELECTRONICS: "Eletrônicos de consumo",
  CONSUMER_GOODS: "Bens de consumo",
  CONSUMER_SERVICES: "Serviços ao consumidor",
  COSMETICS: "Cosméticos",
  E_LEARNING: "Ensino a distância",
  EDUCATION_MANAGEMENT: "Educação",
  ELECTRICAL_ELECTRONIC_MANUFACTURING: "Indústria eletroeletrônica",
  ENTERTAINMENT: "Entretenimento",
  ENVIRONMENTAL_SERVICES: "Serviços ambientais",
  FARMING: "Agropecuária",
  FINANCIAL_SERVICES: "Serviços financeiros",
  FOOD_BEVERAGES: "Alimentos e bebidas",
  FOOD_PRODUCTION: "Produção de alimentos",
  FURNITURE: "Móveis",
  GOVERNMENT_ADMINISTRATION: "Administração pública",
  HEALTH_WELLNESS_AND_FITNESS: "Saúde, bem-estar e fitness",
  HIGHER_EDUCATION: "Ensino superior",
  HOSPITAL_HEALTH_CARE: "Hospitais e saúde",
  HOSPITALITY: "Hotelaria",
  HUMAN_RESOURCES: "Recursos humanos",
  INFORMATION_TECHNOLOGY_AND_SERVICES: "Tecnologia da informação",
  INSURANCE: "Seguros",
  INTERNET: "Internet",
  INVESTMENT_BANKING: "Bancos de investimento",
  INVESTMENT_MANAGEMENT: "Gestão de investimentos",
  LAW_PRACTICE: "Advocacia",
  LEGAL_SERVICES: "Serviços jurídicos",
  LOGISTICS_AND_SUPPLY_CHAIN: "Logística e cadeia de suprimentos",
  MACHINERY: "Máquinas e equipamentos",
  MANAGEMENT_CONSULTING: "Consultoria de gestão",
  MARKETING_AND_ADVERTISING: "Marketing e publicidade",
  MECHANICAL_OR_INDUSTRIAL_ENGINEERING: "Engenharia mecânica e industrial",
  MEDICAL_DEVICES: "Equipamentos médicos",
  MINING_METALS: "Mineração e metais",
  NONPROFIT_ORGANIZATION_MANAGEMENT: "Organizações sem fins lucrativos",
  OIL_ENERGY: "Petróleo e energia",
  PHARMACEUTICALS: "Farmacêutico",
  PRIMARY_SECONDARY_EDUCATION: "Ensino fundamental e médio",
  PUBLISHING: "Editorial",
  REAL_ESTATE: "Imobiliário",
  RENEWABLES_ENVIRONMENT: "Energias renováveis",
  RESTAURANTS: "Restaurantes",
  RETAIL: "Varejo",
  SPORTING_GOODS: "Artigos esportivos",
  STAFFING_AND_RECRUITING: "Recrutamento e seleção",
  SUPERMARKETS: "Supermercados",
  TELECOMMUNICATIONS: "Telecomunicações",
  TEXTILES: "Têxtil",
  TRANSPORTATION_TRUCKING_RAILROAD: "Transporte rodoviário e ferroviário",
  UTILITIES: "Serviços públicos (água, luz, gás)",
  VETERINARY: "Veterinária",
  WHOLESALE: "Atacado",
  WINE_AND_SPIRITS: "Vinhos e destilados",
};

const palavras = (valor: string) => {
  const texto = valor.replace(/_/g, " ").toLowerCase().trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

// the label for a setor value; `hubspot` is HubSpot's own value→label map, when loaded
export function setorLabel(valor: string | null | undefined, hubspot?: ReadonlyMap<string, string>): string {
  if (!valor) return "";
  return SETORES[valor] ?? hubspot?.get(valor) ?? (/^[A-Z0-9_]+$/.test(valor) ? palavras(valor) : valor);
}
