// CNPJ checks for the Empresa schema (utils/schemas/empresa.schema.ts).

// only the digits: "11.222.333/0001-81" -> "11222333000181"
export const normalizarCnpj = (cnpj: string): string => cnpj.replace(/\D/g, "");

// the Receita Federal rule: 14 digits, not all the same, and both check digits (mod 11, weights 2..9) match
export const isCnpjValido = (cnpj: string): boolean => {
   const d = normalizarCnpj(cnpj);
   if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
   const digito = (ate: number) => {
      let soma = 0;
      let peso = ate - 7;
      for (let i = 0; i < ate; i++) {
         soma += Number(d[i]) * peso;
         peso = peso === 2 ? 9 : peso - 1;
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
   };
   return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
};

// 11222333000181 -> 11.222.333/0001-81
export const formatarCnpj = (cnpj: string): string =>
   normalizarCnpj(cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
