-- What the ERP itself knows about a HubSpot contact. Contacts stay in HubSpot (read live, never copied
-- here): these tables hold only fields HubSpot doesn't have, keyed by the contact's HubSpot id.

-- Senioridade: set in the ERP, whether or not HubSpot has hs_seniority. When a contact has no row here,
-- the list falls back to hs_seniority.
CREATE TABLE IF NOT EXISTS "cliente_senioridades" (
	"hubspot_contato_id" text PRIMARY KEY NOT NULL,
	"senioridade" text NOT NULL,
	"atualizado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cliente_senioridades_valor_check" CHECK ("senioridade" IN ('owner', 'partner', 'executive', 'vp', 'director', 'manager', 'senior', 'employee', 'entry'))
);
--> statement-breakpoint
-- Pagamento mensal: a recurring charge modelled on Pix Automático. The client's authorization has a
-- ceiling (valor_maximo) that no cycle may pass, and the ERP sets a floor (valor_minimo) below which a
-- cycle is not charged. Each cycle is one Stripe invoice (Pix or card), issued by the API's scheduler on
-- the cycle's date; Stripe's own subscriptions can't take Pix in Brazil.
--
-- Cycle n is due on data_inicio + n × intervalo (dias or meses), computed from the start each time so a
-- monthly plan on the 31st stays on the last day of shorter months without drifting. A cycle missed while
-- the API was down is skipped, not charged late in a burst; it shows in the history as 'pulado'.
CREATE TABLE IF NOT EXISTS "pagamentos_recorrentes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hubspot_contato_id" text NOT NULL,
	"descricao" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"valor_maximo_centavos" integer NOT NULL,
	"valor_minimo_centavos" integer,
	"intervalo" integer NOT NULL,
	"unidade" text NOT NULL,
	"vencimento_dias" integer DEFAULT 3 NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date,
	"proximo_ciclo" integer DEFAULT 0 NOT NULL,
	"proxima_data" date NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"ultimo_erro" text,
	"criado_por" uuid REFERENCES "usuarios"("id") ON DELETE SET NULL,
	"criado_por_nome" text NOT NULL,
	"criado_por_email" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamentos_recorrentes_status_check" CHECK ("status" IN ('ativo', 'pausado', 'encerrado', 'cancelado')),
	CONSTRAINT "pagamentos_recorrentes_unidade_check" CHECK ("unidade" IN ('dias', 'meses')),
	CONSTRAINT "pagamentos_recorrentes_intervalo_check" CHECK (
		("unidade" = 'dias' AND "intervalo" BETWEEN 1 AND 365) OR ("unidade" = 'meses' AND "intervalo" BETWEEN 1 AND 12)
	),
	CONSTRAINT "pagamentos_recorrentes_valores_check" CHECK (
		"valor_centavos" >= 100
		AND "valor_maximo_centavos" >= "valor_centavos"
		AND "valor_maximo_centavos" <= 100000000
		AND ("valor_minimo_centavos" IS NULL OR ("valor_minimo_centavos" >= 100 AND "valor_minimo_centavos" <= "valor_centavos"))
	),
	CONSTRAINT "pagamentos_recorrentes_vencimento_check" CHECK ("vencimento_dias" BETWEEN 1 AND 60),
	CONSTRAINT "pagamentos_recorrentes_fim_check" CHECK ("data_fim" IS NULL OR "data_fim" >= "data_inicio")
);
--> statement-breakpoint
-- the scheduler's claim query: active plans due today or earlier
CREATE INDEX IF NOT EXISTS "pagamentos_recorrentes_devidos_idx" ON "pagamentos_recorrentes" ("proxima_data") WHERE "status" = 'ativo';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagamentos_recorrentes_contato_idx" ON "pagamentos_recorrentes" ("hubspot_contato_id");
--> statement-breakpoint
-- one row per cycle: what was charged (or why not). The unique (plano, ciclo) is what keeps a cycle from
-- being charged twice, together with the Stripe idempotency key recorrente:<plano>:<ciclo>.
CREATE TABLE IF NOT EXISTS "pagamento_recorrente_ciclos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pagamento_id" uuid NOT NULL REFERENCES "pagamentos_recorrentes"("id") ON DELETE CASCADE,
	"ciclo" integer NOT NULL,
	"data_referencia" date NOT NULL,
	"valor_centavos" integer NOT NULL,
	"status" text NOT NULL,
	"fatura_id" text,
	"fatura_numero" text,
	"fatura_url" text,
	"vencimento" text,
	"email_enviado" boolean DEFAULT false NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamento_recorrente_ciclos_status_check" CHECK ("status" IN ('emitida', 'falhou', 'pulado')),
	CONSTRAINT "pagamento_recorrente_ciclos_unico" UNIQUE ("pagamento_id", "ciclo")
);
