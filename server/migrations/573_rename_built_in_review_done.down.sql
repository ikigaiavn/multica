UPDATE issue_status s
SET name = 'In Review'
WHERE s.is_system
  AND s.key = 'in_review'
  AND s.name = 'Resolved'
  AND NOT EXISTS (
    SELECT 1 FROM issue_status o
    WHERE o.workspace_id = s.workspace_id
      AND o.id <> s.id
      AND o.archived_at IS NULL
      AND lower(o.name) = 'in review'
  );

UPDATE issue_status s
SET name = 'Done'
WHERE s.is_system
  AND s.key = 'done'
  AND s.name = 'Closed'
  AND NOT EXISTS (
    SELECT 1 FROM issue_status o
    WHERE o.workspace_id = s.workspace_id
      AND o.id <> s.id
      AND o.archived_at IS NULL
      AND lower(o.name) = 'done'
  );
