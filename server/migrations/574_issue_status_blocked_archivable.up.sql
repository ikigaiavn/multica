-- Blocked is the one built-in a workspace may retire: unlike the others it
-- defines no lifecycle category of its own (it shares `started`), so archiving
-- it removes a choice without removing a behavior. Every other built-in stays
-- unarchivable. The new rule is strictly weaker than the old one, so existing
-- rows all satisfy it; NOT VALID skips the scan under ACCESS EXCLUSIVE and 575
-- validates.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue_status
    DROP CONSTRAINT IF EXISTS issue_status_system_not_archivable,
    DROP CONSTRAINT IF EXISTS issue_status_system_archivable_blocked_only,
    ADD CONSTRAINT issue_status_system_archivable_blocked_only CHECK (
        NOT is_system OR archived_at IS NULL OR key = 'blocked'
    ) NOT VALID;
