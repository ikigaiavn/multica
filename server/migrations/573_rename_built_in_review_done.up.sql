-- Rename the built-in in_review / done statuses to "Resolved" / "Closed".
-- Keys are unchanged, so issue.status needs no migration. A workspace that
-- already has an active status with the target name keeps the old name rather
-- than violating the per-workspace unique-name index.
UPDATE issue_status s
SET name = 'Resolved'
WHERE s.is_system
  AND s.key = 'in_review'
  AND s.name = 'In Review'
  AND NOT EXISTS (
    SELECT 1 FROM issue_status o
    WHERE o.workspace_id = s.workspace_id
      AND o.id <> s.id
      AND o.archived_at IS NULL
      AND lower(o.name) = 'resolved'
  );

UPDATE issue_status s
SET name = 'Closed'
WHERE s.is_system
  AND s.key = 'done'
  AND s.name = 'Done'
  AND NOT EXISTS (
    SELECT 1 FROM issue_status o
    WHERE o.workspace_id = s.workspace_id
      AND o.id <> s.id
      AND o.archived_at IS NULL
      AND lower(o.name) = 'closed'
  );
