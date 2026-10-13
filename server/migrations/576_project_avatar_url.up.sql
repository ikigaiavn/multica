-- A project can use an uploaded image as its icon. When set it takes
-- precedence over the emoji in `icon`; the emoji stays as the fallback for
-- clients that do not know this column.
ALTER TABLE project ADD COLUMN IF NOT EXISTS avatar_url TEXT;
