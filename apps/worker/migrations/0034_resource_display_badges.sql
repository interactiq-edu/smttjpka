-- Decorative library cover only. Does not affect delivery, scoring, or publishing.
ALTER TABLE learning_resources ADD COLUMN display_badge_id INTEGER CHECK (display_badge_id IS NULL OR display_badge_id BETWEEN 1 AND 30);
