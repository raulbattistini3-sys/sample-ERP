package com.simple_erp.billing.webhook;

import com.stripe.StripeClient;
import com.stripe.model.v2.core.EventNotification;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Stores each event once. Invoice handling joins this transaction, so a failure rolls the event back and
// the 500 makes Stripe deliver it again.
@Slf4j
@Service
@RequiredArgsConstructor
class StripeEventRecorder {

	private final StripeEventRepository events;

	@Transactional
	public void record(EventNotification event, StripeClient client) {
		if (events.insertIfNew(event.getId(), event.getType()) == 0) {
			log.debug("Stripe event {} was already handled", event.getId());
			return;
		}
		log.info("Stripe event {} received: {}", event.getId(), event.getType());
	}

}
