package com.simple_erp.billing.notification;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, String> {

	List<Notification> findTop20BySentAtIsNullAndAttemptsLessThanAndNextAttemptAtLessThanEqualOrderByCreatedAt(
			int attempts, Instant now);

}
