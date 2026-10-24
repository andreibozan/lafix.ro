PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL DEFAULT '', is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
 disabled_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS login_codes (
 email TEXT PRIMARY KEY COLLATE NOCASE, code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (
 rate_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
 slug TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
INSERT OR IGNORE INTO categories (slug,name) VALUES
 ('constructii','Construcții'),('renovari','Renovări'),('acoperisuri','Acoperișuri'),
 ('panouri-solare','Panouri solare'),('incalzire','Încălzire'),('curatenie','Curățenie'),
 ('mutari','Mutări'),('reparatii-auto','Reparații auto');
CREATE TABLE IF NOT EXISTS providers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 business_name TEXT NOT NULL, phone TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','SUSPENDED')),
 reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS provider_categories (
 provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 category_slug TEXT NOT NULL REFERENCES categories(slug), PRIMARY KEY(provider_id,category_slug)
);
CREATE TABLE IF NOT EXISTS provider_areas (
 provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
 county TEXT NOT NULL, PRIMARY KEY(provider_id,county)
);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id), category_slug TEXT NOT NULL REFERENCES categories(slug),
 county TEXT NOT NULL, locality TEXT NOT NULL, description TEXT NOT NULL,
 budget_minor INTEGER CHECK(budget_minor IS NULL OR budget_minor > 0),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','MATCHED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
 accepted_offer_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_matching ON requests(status,category_slug,county,created_at);
CREATE INDEX IF NOT EXISTS idx_requests_customer ON requests(customer_id,created_at);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
 provider_id TEXT NOT NULL REFERENCES providers(id), slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(request_id,provider_id), UNIQUE(request_id,slot)
);
CREATE INDEX IF NOT EXISTS idx_invites_provider ON invitations(provider_id,created_at);
CREATE TABLE IF NOT EXISTS offers (
 id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id),
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), currency TEXT NOT NULL DEFAULT 'RON' CHECK(currency='RON'),
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SENT' CHECK(status IN ('SENT','ACCEPTED','REJECTED','WITHDRAWN')),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE REFERENCES requests(id),
 offer_id TEXT NOT NULL UNIQUE REFERENCES offers(id), customer_id TEXT NOT NULL REFERENCES users(id),
 provider_id TEXT NOT NULL REFERENCES providers(id), price_minor INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK(status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','DISPUTED')),
 completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
 customer_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_cases (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT REFERENCES requests(id),
 message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
 provider_id TEXT PRIMARY KEY REFERENCES providers(id), stripe_customer_id TEXT,
 stripe_subscription_id TEXT UNIQUE, plan TEXT NOT NULL DEFAULT 'FREE' CHECK(plan IN ('FREE','PRO')),
 status TEXT NOT NULL DEFAULT 'INACTIVE', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS billing_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key,value) VALUES ('billing_enabled','0');
CREATE TABLE IF NOT EXISTS audit_log (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
