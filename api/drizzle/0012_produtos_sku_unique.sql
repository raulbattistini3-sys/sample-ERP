-- A SKU identifies one product, active or not: imports already match rows to products by exact SKU and
-- reactivate inactive ones, and two imports (API or importer/) running at once could otherwise both insert
-- the same SKU. Existing duplicates stop the migration with the list, since picking which product survives
-- (auditorias point at them) is a decision for a person, not a migration.
DO $$
DECLARE
	duplicados text;
BEGIN
	SELECT string_agg(format('%s (%s produtos)', sku, total), ', ')
	INTO duplicados
	FROM (SELECT "sku", count(*) AS total FROM "produtos" GROUP BY "sku" HAVING count(*) > 1) d;

	IF duplicados IS NOT NULL THEN
		RAISE EXCEPTION 'SKUs repetidos em produtos: %. Altere ou remova os repetidos e rode a migration de novo.', duplicados;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_sku_key" UNIQUE ("sku");
