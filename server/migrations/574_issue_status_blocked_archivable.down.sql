-- Restores the original rule. Fails if a workspace still has Blocked archived;
-- restore it first (UPDATE issue_status SET archived_at = NULL WHERE is_system).
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue_status
    DROP CONSTRAINT IF EXISTS issue_status_system_archivable_blocked_only,
    DROP CONSTRAINT IF EXISTS issue_status_system_not_archivable,
    ADD CONSTRAINT issue_status_system_not_archivable CHECK (
        NOT is_system OR archived_at IS NULL
    );
