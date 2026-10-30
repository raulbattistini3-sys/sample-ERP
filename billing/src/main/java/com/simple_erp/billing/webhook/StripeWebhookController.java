package com.simple_erp.billing.webhook;

import com.simple_erp.billing.config.StripeProperties;
import com.stripe.StripeClient;
import com.stripe.StripeEventNotificationHandler;
import com.stripe.exception.SignatureVerificationException;
import java.nio.charset.StandardCharsets;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
class StripeWebhookController {

	private final StripeEventNotificationHandler handler;

	StripeWebhookController(StripeClient stripe, StripeProperties properties, StripeEventRecorder recorder) {
		this.handler = stripe
				.notificationHandler(properties.webhookSecret(), (event, client, details) -> log.warn(
						"Unhandled Stripe event {}: {}", event.getId(), event.getType()))
				.onV1InvoicePaid(recorder::paid)
				.onV1InvoicePaymentFailed(recorder::paymentFailed);
	}

	// bytes, not a parsed body: the signature covers exactly what Stripe sent
	@PostMapping("/webhooks/stripe")
	ResponseEntity<Void> receive(@RequestBody byte[] body, @RequestHeader("Stripe-Signature") String signature) {
		try {
			handler.handle(new String(body, StandardCharsets.UTF_8), signature);
			return ResponseEntity.ok().build();
		}
		catch (SignatureVerificationException error) {
			log.warn("Rejected a Stripe webhook: {}", error.getMessage());
			return ResponseEntity.badRequest().build();
		}
	}

}
