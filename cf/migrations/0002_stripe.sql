-- Real Stripe subscriptions: store the Stripe identity on the subscription so the
-- Worker can link checkouts/webhooks and cancel real subscriptions later.

ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT;
