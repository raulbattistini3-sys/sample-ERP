// CPF and date checks shared by the zod schemas (utils/schemas/user.schema.ts) and UsuarioValidator.

// only the digits: "123.456.789-09" -> "12345678909"
export const normalizarCpf = (cpf: string): string => cpf.replace(/\D/g, "");

// the Receita Federal rule: 11 digits, not all the same, and both check digits (mod 11) match
export const isCpfValido = (cpf: string): boolean => {
   const d = normalizarCpf(cpf);
   if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
   const digito = (ate: number) => {
      let soma = 0;
      for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
   };
   return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
};

// a real calendar date written YYYY-MM-DD ("2024-02-30" is refused), not in the future, after 1900
export const isDataNascimentoValida = (data: string): boolean => {
   if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
   const dt = new Date(`${data}T00:00:00Z`);
   if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== data) return false;
   return data >= "1900-01-01" && dt.getTime() <= Date.now();
};
