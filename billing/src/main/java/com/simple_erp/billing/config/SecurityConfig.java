package com.simple_erp.billing.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
public class SecurityConfig {

	// No sessions or cookies, so no CSRF. Stripe's signature protects the webhook; /internal/** takes the
	// Node API's BILLING_INTERNAL_TOKEN (InternalTokenFilter); everything else stays closed.
	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, ErpProperties erp) throws Exception {
		return http
				.csrf(AbstractHttpConfigurer::disable)
				.sessionManagement((session) -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.addFilterBefore(new InternalTokenFilter(erp.internalToken()), AnonymousAuthenticationFilter.class)
				.authorizeHttpRequests((requests) -> requests
						.requestMatchers("/webhooks/stripe", "/actuator/health", "/docs", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
						.requestMatchers(InternalTokenFilter.PREFIX + "**").permitAll()
						.anyRequest().denyAll())
				.build();
	}

}
