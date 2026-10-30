package com.simple_erp.billing.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

	public static final String STRIPE_SIGNATURE = "stripeSignature";

	@Bean
	OpenAPI billingOpenApi() {
		return new OpenAPI()
				.components(new Components().addSecuritySchemes(STRIPE_SIGNATURE, new SecurityScheme()
						.type(SecurityScheme.Type.APIKEY)
						.in(SecurityScheme.In.HEADER)
						.name("Stripe-Signature")
						.description("Stripe's t=...,v1=... signature of the raw body")))
				.info(new Info()
				.title("Billing")
				.version("v1")
				.description("""
						Receives Stripe's webhooks. A paid or failed invoice is stored here, and a background job then \
						notifies the ERP API, which sends the e-mail. Nothing in this service is called by the browser."""));
	}

}
