package com.simple_erp.billing.config;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Runs once the environment is ready (real variables and billing/.env both loaded) and before any bean
 * exists: checks the required variables and sets the database's TLS. Every problem is printed at once and
 * the JVM exits with status 1, the equivalent of Go's os.Exit(1). Registered in BillingApplication.main,
 * so tests that build their own context skip it.
 */
public final class StartupChecks implements ApplicationListener<ApplicationEnvironmentPreparedEvent> {

	@Override
	public void onApplicationEvent(ApplicationEnvironmentPreparedEvent event) {
		ConfigurableEnvironment env = event.getEnvironment();
		List<String> errors = new ArrayList<>();

		RequiredEnvironment.check(env, errors);

		String mode = DatabaseTls.mode(env.getProperty("BILLING_ENV"), errors);
		String url = env.getProperty("spring.datasource.url", "");
		if (mode != null && !url.isBlank()) {
			String rewritten = DatabaseTls.rewrite(url, mode, env.getProperty("DATABASE_CA_CERT"), Path.of(""),
					errors);
			if (rewritten != null) {
				env.getPropertySources()
					.addFirst(new MapPropertySource("billingDatabaseTls", Map.of("spring.datasource.url", rewritten)));
			}
		}

		if (!errors.isEmpty()) {
			errors.forEach((error) -> System.err.println("[config] " + error));
			System.exit(1);
		}
	}

}
