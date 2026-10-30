package com.simple_erp.billing.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("erp")
public record ErpProperties(
		@NotBlank(message = "set ERP_API_URL in billing/.env") String apiUrl,
		@NotBlank(message = "set BILLING_INTERNAL_TOKEN in billing/.env, the same value as in api/.env") String internalToken) {
}
