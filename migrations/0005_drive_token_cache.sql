CREATE TABLE drive_oauth_cache (
  cache_key TEXT PRIMARY KEY CHECK (cache_key='service_account'),
  token_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_migrations(version) VALUES ('0005_drive_token_cache');
