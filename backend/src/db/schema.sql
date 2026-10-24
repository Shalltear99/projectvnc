-- CloudJava VNC control-plane schema (PostgreSQL 14+)
-- Idempotent: safe to run on every deploy.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    suspended_at  timestamptz
);

CREATE TABLE IF NOT EXISTS instances (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plan_id         text NOT NULL,
    container_id    text,
    ws_port         integer,
    vnc_port        integer,
    status          text NOT NULL DEFAULT 'provisioning'
                    CHECK (status IN ('provisioning','running','stopped','expired','failed')),
    java_version    smallint NOT NULL DEFAULT 17,
    vnc_password    text NOT NULL,
    proxy_path      text NOT NULL,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    failure_reason  text
);

-- One live instance per container / port pair: the allocator is the primary
-- guard, these indexes are the second line of defence against double-booking.
CREATE UNIQUE INDEX IF NOT EXISTS instances_container_id_key
    ON instances (container_id) WHERE container_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS instances_ws_port_live_key
    ON instances (ws_port) WHERE status IN ('provisioning', 'running');
CREATE INDEX IF NOT EXISTS instances_user_idx ON instances (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS instances_expiry_idx ON instances (expires_at)
    WHERE status IN ('provisioning', 'running', 'stopped');

CREATE TABLE IF NOT EXISTS orders (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plan_id      text NOT NULL,
    provider     text NOT NULL,
    provider_ref text NOT NULL,
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','failed','expired')),
    amount_idr   bigint NOT NULL CHECK (amount_idr >= 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    paid_at      timestamptz
);

-- Webhook idempotency: a provider reference may only be recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_ref_key
    ON orders (provider, provider_ref);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
    id          bigserial PRIMARY KEY,
    actor       text NOT NULL,
    action      text NOT NULL,
    target      text,
    detail      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
