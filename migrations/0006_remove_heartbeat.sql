-- Processing is performed by stateless remote runs. A job is recovered from
-- its started_at timestamp; no agent heartbeat is part of the architecture.
-- The historical column remains inert so this migration is safe for both
-- existing deployments and fresh databases.
INSERT INTO schema_migrations(version) VALUES ('0006_remove_heartbeat');
