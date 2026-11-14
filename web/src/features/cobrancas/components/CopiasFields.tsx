import { Field, Input } from "../../../components/ui/Field";

type Props = {
  prefixo: string;
  cc: string;
  cco: string;
  onCc: (v: string) => void;
  onCco: (v: string) => void;
  erroCc?: string | null;
  erroCco?: string | null;
};

// CC/CCO of the billing e-mail sent to the client. Resend's test mode only delivers to the account's own
// address; when it refuses the copies the API sends to the client alone and says so in the result.
export function CopiasFields({ prefixo, cc, cco, onCc, onCco, erroCc, erroCco }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${prefixo}-cc`} label="Cc (opcional)" error={erroCc ?? undefined} hint="Recebem uma cópia do e-mail da cobrança. Separe por vírgula.">
        <Input
          id={`${prefixo}-cc`}
          type="text"
          inputMode="email"
          autoComplete="email"
          multiple
          placeholder="financeiro@cliente.com.br"
          value={cc}
          onChange={(e) => onCc(e.target.value)}
          invalid={!!erroCc}
        />
      </Field>
      <Field id={`${prefixo}-cco`} label="Cco (opcional)" error={erroCco ?? undefined} hint="Cópia oculta: o cliente não vê esses endereços.">
        <Input
          id={`${prefixo}-cco`}
          type="text"
          inputMode="email"
          autoComplete="email"
          multiple
          placeholder="contabilidade@suaempresa.com.br"
          value={cco}
          onChange={(e) => onCco(e.target.value)}
          invalid={!!erroCco}
        />
      </Field>
    </div>
  );
}
