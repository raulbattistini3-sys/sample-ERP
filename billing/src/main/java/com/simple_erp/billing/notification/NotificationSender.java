package com.simple_erp.billing.notification;

import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

// Sends what the webhook saved to the Node API, which decides what to do with it (e-mail, SSE, ...). A
// delivery can repeat, so eventId is what Node uses to do the work once.
@Slf4j
@Component
@RequiredArgsConstructor
class NotificationSender {

	private static final String PATH = "/internal/billing/events";

	private final NotificationRepository notifications;
	private final RestClient erpClient;

	@Scheduled(fixedDelayString = "${erp.send-delay-ms:5000}")
	void sendDue() {
		this.notifications
				.findTop20BySentAtIsNullAndAttemptsLessThanAndNextAttemptAtLessThanEqualOrderByCreatedAt(
						Notification.MAX_ATTEMPTS, Instant.now())
				.forEach(this::send);
	}

	private void send(Notification notification) {
		try {
			this.erpClient.post()
					.uri(PATH)
					.contentType(MediaType.APPLICATION_JSON)
					.body(new NotificationRequest(notification))
					.retrieve()
					.toBodilessEntity();
			notification.markSent();
		}
		catch (HttpClientErrorException.BadRequest error) {
			log.error("The ERP rejected notification {}: {}", notification.getEventId(), error.getMessage());
			notification.giveUp();
		}
		catch (RestClientException error) {
			notification.retryLater();
			log.warn("Notification {} failed, attempt {}: {}", notification.getEventId(), notification.getAttempts(),
					error.getMostSpecificCause().toString());
		}
		this.notifications.save(notification);
		if (notification.exhausted()) {
			log.error("Notification {} gave up after {} attempts", notification.getEventId(), notification.getAttempts());
		}
	}

	record NotificationRequest(String eventId, String tipo, String faturaId, String numero, long valorCentavos,
			String moeda, String email, String nome, String url) {

		NotificationRequest(Notification notification) {
			this(notification.getEventId(), notification.getType(), notification.getInvoiceId(),
					notification.getInvoiceNumber(), notification.getAmountCents(), notification.getCurrency(),
					notification.getCustomerEmail(), notification.getCustomerName(), notification.getInvoiceUrl());
		}

	}

}
