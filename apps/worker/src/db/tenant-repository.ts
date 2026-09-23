import type { Tenant, TenantSettings, TenantStatus } from '@interactiq/contracts';
import type { D1Database } from './types';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

interface TenantSettingsRow {
  tenant_id: string;
  accent_color: string | null;
  welcome_message: string | null;
  logo_media_id: string | null;
  favicon_media_id: string | null;
  updated_at: string;
}

const tenantColumns = 'id, slug, name, status, created_at, updated_at';

const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toTenantSettings = (row: TenantSettingsRow): TenantSettings => ({
  tenantId: row.tenant_id,
  accentColor: row.accent_color,
  welcomeMessage: row.welcome_message,
  logoMediaId: row.logo_media_id,
  faviconMediaId: row.favicon_media_id,
  updatedAt: row.updated_at,
});

export class TenantRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(`SELECT ${tenantColumns} FROM tenants WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<TenantRow>();

    return row ? toTenant(row) : null;
  }

  async findActiveBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.db
      .prepare(`SELECT ${tenantColumns} FROM tenants WHERE slug = ? AND status = 'active' LIMIT 1`)
      .bind(slug)
      .first<TenantRow>();

    return row ? toTenant(row) : null;
  }

  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    const row = await this.db
      .prepare(
        'SELECT tenant_id, accent_color, welcome_message, logo_media_id, favicon_media_id, updated_at FROM tenant_settings WHERE tenant_id = ? LIMIT 1',
      )
      .bind(tenantId)
      .first<TenantSettingsRow>();

    return row ? toTenantSettings(row) : null;
  }
}
