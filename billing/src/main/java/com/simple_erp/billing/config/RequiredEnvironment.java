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
			"ERP_API_URL", "the API's address, e.g. http://127.0.0.1:3333",
			"BILLING_INTERNAL_TOKEN", "the same value as BILLING_INTERNAL_TOKEN in api/.env");

	private RequiredEnvironment() {
	}

	static void check(Environment env, List<String> errors) {
		REQUIRED.entrySet()
			.stream()
			.sorted(Map.Entry.comparingByKey())
			.filter((entry) -> env.getProperty(entry.getKey(), "").isBlank())
			.forEach((entry) -> errors.add(entry.getKey() + " is required: " + entry.getValue() + " (billing/.env)"));
	}

}
