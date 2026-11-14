import { SVGProps } from "react";

// Pagamento mensal: lucide's "repeat" arrows with a "$" between them, so it reads as a recurring charge
export function PagamentoMensalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <path d="M12 8.5v7" strokeWidth={1.5} />
      <path d="M14 9.75h-2.6a1.15 1.15 0 0 0 0 2.3h1.2a1.15 1.15 0 0 1 0 2.3H10" strokeWidth={1.5} />
    </svg>
  );
}
