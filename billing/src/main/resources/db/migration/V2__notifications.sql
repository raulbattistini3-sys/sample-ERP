-- What the Node API still has to hear about. Saved with the event, so a paid invoice can't be lost while
-- Node is down, and sent afterwards so the webhook answers Stripe without waiting for it.
CREATE TABLE billing.notifications (
	event_id        text PRIMARY KEY REFERENCES billing.stripe_events (event_id),
	type            text NOT NULL,
	invoice_id      text NOT NULL,
	invoice_number  text,
	amount_cents    bigint NOT NULL,
	currency        text NOT NULL,
	customer_email  text NOT NULL,
	customer_name   text,
	invoice_url     text,
	attempts        integer NOT NULL DEFAULT 0,
	next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
	sent_at         timestamp with time zone,
	created_at      timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX notifications_pending_idx ON billing.notifications (next_attempt_at) WHERE sent_at IS NULL;
