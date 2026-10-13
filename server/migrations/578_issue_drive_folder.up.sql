-- Google Drive folder created for an issue (<project folder>/Resources/<KEY>).
-- Set once, the first time someone asks for it; never rewritten.
ALTER TABLE issue ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
