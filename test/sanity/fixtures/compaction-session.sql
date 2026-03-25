-- Seed a large session to test compaction circuit breaker
-- This creates a session with enough message data to trigger isOverflow()
-- Note: This is a minimal seed — actual compaction depends on token counting
-- which requires the LLM provider. This just ensures the DB structure is valid.

INSERT OR IGNORE INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
VALUES ('ses_sanity_compaction_test', 'proj_sanity', 'sanity-compaction', '/tmp', 'Compaction Test Session', 1, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
