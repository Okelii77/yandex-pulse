-- Apply only to RC2 D1 after verifying columns are absent. Never production.
ALTER TABLE rc_lease ADD COLUMN owner TEXT;
ALTER TABLE rc_lease ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS rc_daily_budget(day INTEGER PRIMARY KEY,api INTEGER NOT NULL,launch INTEGER NOT NULL,reads INTEGER NOT NULL,writes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rc_oidc_used(jti TEXT PRIMARY KEY,expires INTEGER NOT NULL);
