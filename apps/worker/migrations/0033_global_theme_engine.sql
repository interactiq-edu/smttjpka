-- Keep the ten legacy CHECK-constrained theme columns intact. Existing resources
-- retain their own appearance; new resources can inherit the tenant-wide theme.
CREATE TABLE tenant_theme_preferences (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL CHECK (theme_id IN ('AURORA','OCEAN','SUNSET','FOREST','GALAXY','CANDY','NEON','PAPER','SAFARI','MIDNIGHT','GLASSWAVE_LEARN')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE resource_theme_overrides (
  resource_id TEXT PRIMARY KEY REFERENCES learning_resources(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL CHECK (theme_id IN ('AURORA','OCEAN','SUNSET','FOREST','GALAXY','CANDY','NEON','PAPER','SAFARI','MIDNIGHT','GLASSWAVE_LEARN')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenant_theme_preferences (tenant_id, theme_id)
  SELECT tenant_id, default_theme FROM tenant_settings;

INSERT INTO resource_theme_overrides (resource_id, theme_id)
  SELECT id, theme_id FROM learning_resources;
