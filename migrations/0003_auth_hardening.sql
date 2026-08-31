ALTER TABLE auth_challenges ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);
INSERT INTO schema_migrations(version) VALUES ('0003_auth_hardening');
