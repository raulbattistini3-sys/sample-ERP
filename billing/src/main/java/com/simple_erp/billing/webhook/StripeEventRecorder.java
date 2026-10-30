package com.simple_erp.billing.webhook;

import com.simple_erp.billing.notification.Notification;
import com.simple_erp.billing.notification.NotificationRepository;
import com.stripe.StripeClient;
import com.stripe.events.V1InvoicePaidEventNotification;
import com.stripe.events.V1InvoicePaymentFailedEventNotification;
import com.stripe.exception.StripeException;
import com.stripe.model.Invoice;
import com.stripe.model.v2.core.EventNotification;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Stores each event once, along with what the ERP has to hear about it. A failure rolls both back, and the
// 500 makes Stripe deliver the event again.
@Slf4j
@Service
@RequiredArgsConstructor
class StripeEventRecorder {

	static final String INVOICE_PAID = "fatura_paga";
	static final String INVOICE_FAILED = "fatura_falhou";

	private final StripeEventRepository events;
	private final NotificationRepository notifications;

	@Transactional
	public void paid(V1InvoicePaidEventNotification event, StripeClient client) {
		if (isNew(event)) {
			Invoice invoice = fetch(event::fetchRelatedObject);
			notify(event, INVOICE_PAID, invoice, invoice.getAmountPaid());
		}
	}

	@Transactional
	public void paymentFailed(V1InvoicePaymentFailedEventNotification event, StripeClient client) {
		if (isNew(event)) {
			Invoice invoice = fetch(event::fetchRelatedObject);
			notify(event, INVOICE_FAILED, invoice, invoice.getAmountDue());
		}
	}

	private boolean isNew(EventNotification event) {
		boolean isNew = this.events.insertIfNew(event.getId(), event.getType()) == 1;
		log.info("Stripe event {} ({}): {}", event.getId(), event.getType(), isNew ? "received" : "already handled");
		return isNew;
	}

	private void notify(EventNotification event, String type, Invoice invoice, long amountCents) {
		if (invoice.getCustomerEmail() == null) {
			log.warn("Invoice {} has no customer e-mail, nothing to notify", invoice.getId());
			return;
		}
		this.notifications.save(Notification.of(event.getId(), type, invoice, amountCents));
	}

	private static Invoice fetch(InvoiceFetch fetch) {
		try {
			return fetch.get();
		}
		catch (StripeException error) {
			throw new IllegalStateException("Could not read the invoice from Stripe", error);
		}
	}

	@FunctionalInterface
	private interface InvoiceFetch {

		Invoice get() throws StripeException;

	}

}
