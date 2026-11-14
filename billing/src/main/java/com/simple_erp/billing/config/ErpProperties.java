package com.simple_erp.billing.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("erp")
public record ErpProperties(
		// optional when NETWORK_URL is set (the API is then found by name); RequiredEnvironment checks it
		String apiUrl) {
}
