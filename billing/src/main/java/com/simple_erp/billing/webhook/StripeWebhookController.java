package com.simple_erp.billing.webhook;

import com.simple_erp.billing.config.OpenApiConfig;
import com.simple_erp.billing.config.StripeProperties;
import com.stripe.StripeClient;
import com.stripe.StripeEventNotificationHandler;
import com.stripe.exception.SignatureVerificationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@Tag(name = "Webhooks", description = "Called by Stripe, or by the Stripe CLI when testing locally")
class StripeWebhookController {

	private static final String EXAMPLE_EVENT = """
			{
			  "id": "evt_123",
			  "object": "v2.core.event",
			  "type": "v1.invoice.paid",
			  "livemode": false,
			  "created": "2026-10-30T12:00:00.000Z",
			  "related_object": { "id": "in_123", "type": "invoice", "url": "/v1/invoices/in_123" }
			}""";

	private final StripeEventNotificationHandler handler;

	StripeWebhookController(StripeClient stripe, StripeProperties properties, StripeEventRecorder recorder) {
		this.handler = stripe
				.notificationHandler(properties.webhookSecret(), (event, client, details) -> log.warn(
						"Unhandled Stripe event {}: {}", event.getId(), event.getType()))
				.onV1InvoicePaid(recorder::paid)
				.onV1InvoicePaymentFailed(recorder::paymentFailed);
	}

	// bytes, not a parsed body: the signature covers exactly what Stripe sent
	@Operation(
			summary = "Receive a Stripe event",
			security = @SecurityRequirement(name = OpenApiConfig.STRIPE_SIGNATURE),
			description = "Takes thin events, signed with STRIPE_WEBHOOK_SECRET. Handles v1.invoice.paid and "
					+ "v1.invoice.payment_failed; any other type is logged and answered with 200. A repeated event id changes "
					+ "nothing. An invoice without a customer e-mail is stored but creates no notification.",
			requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true, content = @Content(
					mediaType = "application/json", schema = @Schema(type = "object"),
					examples = @ExampleObject(name = "invoice paid", value = EXAMPLE_EVENT))),
			responses = {
				@ApiResponse(responseCode = "200", description = "Stored, already handled, or a type this service ignores"),
				@ApiResponse(responseCode = "400", description = "Signature missing, invalid or too old"),
				@ApiResponse(responseCode = "500", description = "Could not process it. Stripe delivers the event again") })
	@PostMapping("/webhooks/stripe")
	ResponseEntity<Void> receive(@RequestBody byte[] body,
			@Parameter(hidden = true) @RequestHeader("Stripe-Signature") String signature) {
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
