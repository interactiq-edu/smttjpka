ALTER TABLE learning_resources ADD COLUMN share_code TEXT;
ALTER TABLE learning_resources ADD COLUMN published_at TEXT;
CREATE UNIQUE INDEX idx_learning_resources_share_code ON learning_resources(share_code) WHERE share_code IS NOT NULL;

ALTER TABLE questions ADD COLUMN time_limit_seconds INTEGER CHECK (time_limit_seconds IS NULL OR (time_limit_seconds >= 5 AND time_limit_seconds <= 5400));
