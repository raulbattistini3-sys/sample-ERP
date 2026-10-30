package com.simple_erp.billing.webhook;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "stripe_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
class StripeEvent {

	@Id
	@Column(name = "event_id")
	private String eventId;

	@Column(name = "event_type", nullable = false)
	private String eventType;

	@Column(name = "received_at", nullable = false, insertable = false, updatable = false)
	private OffsetDateTime receivedAt;

}
