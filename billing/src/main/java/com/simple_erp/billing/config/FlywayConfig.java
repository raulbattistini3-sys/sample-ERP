package com.simple_erp.billing.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.flyway.autoconfigure.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlywayConfig {

	private static final String TRANSACTION_POOLER_PORT = ":6543/";

	// Flyway sets search_path on its session. Through the transaction pooler that can stay on a backend the
	// ERP shares, and the ERP's queries then look for their tables in the wrong schema.
	@Bean
	FlywayConfigurationCustomizer refuseTransactionPooler(@Value("${spring.datasource.url}") String url) {
		return (configuration) -> {
			if (url.contains(TRANSACTION_POOLER_PORT)) {
				throw new IllegalStateException(
						"JDBC_DATABASE_URL uses the transaction pooler (6543). Use the session pooler's port 5432.");
			}
		};
	}

}
