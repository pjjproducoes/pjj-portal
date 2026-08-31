PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','client')),
  password_hash TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0,1)),
  mfa_secret_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','locked','disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  logo_drive_file_id TEXT,
  primary_contact_name TEXT,
  email TEXT COLLATE NOCASE,
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','trashed')),
  branding_json TEXT NOT NULL DEFAULT '{}',
  drive_folder_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trashed_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  location_text TEXT,
  latitude REAL,
  longitude REAL,
  cover_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','review','published','archived','trashed')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','public_demo')),
  drive_folder_id TEXT UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trashed_at TEXT,
  UNIQUE(client_id, slug)
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  captured_at TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','uploading','processing','review','published','archived','trashed')),
  metrics_json TEXT NOT NULL DEFAULT '{}',
  drive_folder_id TEXT UNIQUE,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trashed_at TEXT,
  UNIQUE(project_id, captured_at)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  capture_id TEXT REFERENCES captures(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('orthophoto','dsm','dtm','model_3d','point_cloud','photo','video','pdf','document','source','other')),
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  original_drive_file_id TEXT UNIQUE,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum_sha256 TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  replaces_asset_id TEXT REFERENCES assets(id),
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','received','validating','processing','review','published','failed','archived','trashed')),
  downloadable INTEGER NOT NULL DEFAULT 1 CHECK (downloadable IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  trashed_at TEXT
);

CREATE TABLE asset_variants (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  variant_type TEXT NOT NULL,
  drive_file_id TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum_sha256 TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('queued','processing','ready','failed','archived','trashed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, variant_type)
);

CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE RESTRICT,
  drive_session_url_ciphertext TEXT NOT NULL,
  total_bytes INTEGER NOT NULL CHECK (total_bytes > 0),
  received_bytes INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  chunk_size_bytes INTEGER NOT NULL CHECK (chunk_size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','failed','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','retrying','succeeded','failed','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  next_attempt_at TEXT
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('view','download','manage')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view','download')),
  expires_at TEXT,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  grant_id TEXT REFERENCES access_grants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((user_id IS NOT NULL) != (grant_id IS NOT NULL))
);

CREATE TABLE embeds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  allowed_products_json TEXT NOT NULL DEFAULT '[]',
  branding_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE embed_domains (
  id TEXT PRIMARY KEY,
  embed_id TEXT NOT NULL REFERENCES embeds(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(embed_id, hostname)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system','admin','client','grant','embed')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failure')),
  ip_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_projects_client_status ON projects(client_id, status);
CREATE INDEX idx_captures_project_date ON captures(project_id, captured_at DESC);
CREATE INDEX idx_assets_project_status ON assets(project_id, status);
CREATE INDEX idx_assets_capture_type ON assets(capture_id, type);
CREATE INDEX idx_variants_asset_status ON asset_variants(asset_id, status);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status, expires_at);
CREATE INDEX idx_jobs_dispatch ON processing_jobs(status, next_attempt_at, queued_at);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at, idle_expires_at);
CREATE INDEX idx_grants_project ON access_grants(project_id, expires_at);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_rate_limits_blocked ON rate_limits(blocked_until);

INSERT INTO schema_migrations(version) VALUES ('0001_core');
