package com.simple_erp.billing.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("stripe")
public record StripeProperties(
		@NotBlank(message = "set SANDBOX_STRIPE_API_KEY in billing/.env") String apiKey,
		@NotBlank(message = "set STRIPE_WEBHOOK_SECRET in billing/.env, stripe listen prints it") String webhookSecret) {
}
