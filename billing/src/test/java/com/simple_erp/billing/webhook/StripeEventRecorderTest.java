package com.simple_erp.billing.webhook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.simple_erp.billing.notification.Notification;
import com.simple_erp.billing.notification.NotificationRepository;
import com.stripe.events.V1InvoicePaidEventNotification;
import com.stripe.events.V1InvoicePaymentFailedEventNotification;
import com.stripe.exception.ApiConnectionException;
import com.stripe.model.Invoice;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class StripeEventRecorderTest {

	private final StripeEventRepository events = mock();
	private final NotificationRepository notifications = mock();
	private final StripeEventRecorder recorder = new StripeEventRecorder(this.events, this.notifications);

	@BeforeEach
	void newEvent() {
		when(this.events.insertIfNew(anyString(), anyString())).thenReturn(1);
	}

	@Test
	void savesWhatTheErpNeedsToHearAboutAPaidInvoice() throws Exception {
		V1InvoicePaidEventNotification event = paidEvent(invoice("cliente@example.com"));

		this.recorder.paid(event, null);

		ArgumentCaptor<Notification> saved = ArgumentCaptor.forClass(Notification.class);
		verify(this.notifications).save(saved.capture());
		assertThat(saved.getValue().getEventId()).isEqualTo("evt_1");
		assertThat(saved.getValue().getType()).isEqualTo(StripeEventRecorder.INVOICE_PAID);
		assertThat(saved.getValue().getAmountCents()).isEqualTo(15000);
		assertThat(saved.getValue().getCustomerEmail()).isEqualTo("cliente@example.com");
	}

	@Test
	void usesTheAmountDueForAFailedPayment() throws Exception {
		V1InvoicePaymentFailedEventNotification event = mock();
		when(event.getId()).thenReturn("evt_2");
		when(event.getType()).thenReturn("v1.invoice.payment_failed");
		when(event.fetchRelatedObject()).thenReturn(invoice("cliente@example.com"));

		this.recorder.paymentFailed(event, null);

		ArgumentCaptor<Notification> saved = ArgumentCaptor.forClass(Notification.class);
		verify(this.notifications).save(saved.capture());
		assertThat(saved.getValue().getType()).isEqualTo(StripeEventRecorder.INVOICE_FAILED);
		assertThat(saved.getValue().getAmountCents()).isEqualTo(20000);
	}

	@Test
	void doesNothingForARetriedEvent() throws Exception {
		when(this.events.insertIfNew(anyString(), anyString())).thenReturn(0);
		V1InvoicePaidEventNotification event = paidEvent(invoice("cliente@example.com"));

		this.recorder.paid(event, null);

		verify(event, never()).fetchRelatedObject();
		verify(this.notifications, never()).save(any());
	}

	@Test
	void skipsAnInvoiceWithoutAnEmail() throws Exception {
		this.recorder.paid(paidEvent(invoice(null)), null);

		verify(this.notifications, never()).save(any());
	}

	@Test
	void failsWhenStripeCannotBeReachedSoTheEventIsRetried() throws Exception {
		V1InvoicePaidEventNotification event = paidEvent(null);
		when(event.fetchRelatedObject()).thenThrow(new ApiConnectionException("down"));

		org.assertj.core.api.Assertions.assertThatIllegalStateException()
				.isThrownBy(() -> this.recorder.paid(event, null));
	}

	private static V1InvoicePaidEventNotification paidEvent(Invoice invoice) throws Exception {
		V1InvoicePaidEventNotification event = mock();
		when(event.getId()).thenReturn("evt_1");
		when(event.getType()).thenReturn("v1.invoice.paid");
		when(event.fetchRelatedObject()).thenReturn(invoice);
		return event;
	}

	private static Invoice invoice(String email) {
		Invoice invoice = new Invoice();
		invoice.setId("in_1");
		invoice.setNumber("A-0001");
		invoice.setCurrency("brl");
		invoice.setAmountPaid(15000L);
		invoice.setAmountDue(20000L);
		invoice.setCustomerEmail(email);
		return invoice;
	}

}
