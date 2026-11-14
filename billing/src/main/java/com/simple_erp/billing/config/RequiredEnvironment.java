package com.simple_erp.billing.config;

import java.util.List;
import java.util.Map;

import org.springframework.core.env.Environment;

/**
 * Variables billing can't start without, read from the environment or billing/.env. Missing ones stop
 * startup (StartupChecks) with what to set, instead of a bean failing later with a stack trace.
 */
final class RequiredEnvironment {

	private static final Map<String, String> REQUIRED = Map.of(
			"JDBC_DATABASE_URL", "the database, as jdbc:postgresql://host:5432/db?user=...&password=...",
			"SANDBOX_STRIPE_API_KEY", "the Stripe sandbox key (sk_test_...)",
			"STRIPE_WEBHOOK_SECRET", "the webhook signing secret (whsec_..., printed by stripe listen)",
			"ERP_API_URL", "the API's address, e.g. https://127.0.0.1:3333 (or set NETWORK_URL to find it by name)",
			"BILLING_TLS_CERT", "billing's certificate, secrets/tls/billing.crt (bun run secrets)",
			"BILLING_TLS_KEY", "its key, secrets/tls/billing.key",
			"BILLING_TLS_CA", "the internal CA, secrets/tls/ca.crt");

	private RequiredEnvironment() {
	}

	static void check(Environment env, List<String> errors) {
		REQUIRED.entrySet()
			.stream()
			.sorted(Map.Entry.comparingByKey())
			.filter((entry) -> env.getProperty(entry.getKey(), "").isBlank())
			// with the network service billing finds the API by name, so its address is optional
			.filter((entry) -> !(entry.getKey().equals("ERP_API_URL") && !env.getProperty("NETWORK_URL", "").isBlank()))
			.forEach((entry) -> errors.add(entry.getKey() + " is required: " + entry.getValue() + " (billing/.env)"));
	}

}
