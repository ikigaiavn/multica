-- A separate transaction scans under SHARE UPDATE EXCLUSIVE, allowing normal
-- reads/writes. No ACCESS EXCLUSIVE operation belongs in this file.
SET LOCAL lock_timeout = '2s';
ALTER TABLE issue_status
    VALIDATE CONSTRAINT issue_status_system_archivable_blocked_only;
