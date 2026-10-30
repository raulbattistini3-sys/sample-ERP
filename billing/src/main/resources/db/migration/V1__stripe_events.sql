-- Every Stripe event already handled. Stripe can deliver one more than once, so the primary key is what
-- makes a retry a no-op.
CREATE TABLE stripe_events (
	event_id    text PRIMARY KEY,
	event_type  text NOT NULL,
	received_at timestamp with time zone NOT NULL DEFAULT now()
);
