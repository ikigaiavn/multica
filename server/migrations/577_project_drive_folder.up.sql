-- Google Drive folder that holds a project's files (for example the
-- "02-Blum" folder under 04-Projects). Issue folders are created inside its
-- "Resources" child on demand.
ALTER TABLE project ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
