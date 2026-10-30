package com.simple_erp.billing.webhook;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface StripeEventRepository extends JpaRepository<StripeEvent, String> {

	// 1 for a new event, 0 for a retry, without a race between two deliveries of the same one
	@Modifying
	@Query(value = """
			insert into stripe_events (event_id, event_type)
			values (:eventId, :eventType)
			on conflict (event_id) do nothing""", nativeQuery = true)
	int insertIfNew(@Param("eventId") String eventId, @Param("eventType") String eventType);

}
