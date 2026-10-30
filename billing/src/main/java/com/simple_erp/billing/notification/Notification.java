package com.simple_erp.billing.notification;

import com.stripe.model.Invoice;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "notifications")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Notification {

	static final int MAX_ATTEMPTS = 10;
	private static final Duration MAX_BACKOFF = Duration.ofHours(1);

	@Id
	@Column(name = "event_id")
	private String eventId;

	@Column(nullable = false)
	private String type;

	@Column(name = "invoice_id", nullable = false)
	private String invoiceId;

	@Column(name = "invoice_number")
	private String invoiceNumber;

	@Column(name = "amount_cents", nullable = false)
	private long amountCents;

	@Column(nullable = false)
	private String currency;

	@Column(name = "customer_email", nullable = false)
	private String customerEmail;

	@Column(name = "customer_name")
	private String customerName;

	@Column(name = "invoice_url")
	private String invoiceUrl;

	@Column(nullable = false)
	private int attempts;

	@Column(name = "next_attempt_at", nullable = false)
	private Instant nextAttemptAt;

	@Column(name = "sent_at")
	private Instant sentAt;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	public static Notification of(String eventId, String type, Invoice invoice, long amountCents) {
		Notification notification = new Notification();
		notification.eventId = eventId;
		notification.type = type;
		notification.invoiceId = invoice.getId();
		notification.invoiceNumber = invoice.getNumber();
		notification.amountCents = amountCents;
		notification.currency = invoice.getCurrency();
		notification.customerEmail = invoice.getCustomerEmail();
		notification.customerName = invoice.getCustomerName();
		notification.invoiceUrl = invoice.getHostedInvoiceUrl();
		notification.createdAt = Instant.now();
		notification.nextAttemptAt = notification.createdAt;
		return notification;
	}

	void markSent() {
		this.attempts++;
		this.sentAt = Instant.now();
	}

	// doubles each time, from 1 minute up to an hour
	void retryLater() {
		this.attempts++;
		Duration backoff = Duration.ofMinutes(1L << Math.min(this.attempts - 1, 6));
		this.nextAttemptAt = Instant.now().plus(backoff.compareTo(MAX_BACKOFF) < 0 ? backoff : MAX_BACKOFF);
	}

	// Node rejected the content, so asking again can't help
	void giveUp() {
		this.attempts = MAX_ATTEMPTS;
	}

	boolean exhausted() {
		return this.sentAt == null && this.attempts >= MAX_ATTEMPTS;
	}

}
