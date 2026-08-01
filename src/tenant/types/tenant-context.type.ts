export interface TenantOrg {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

// Augment the Express Request so TypeScript knows about these fields.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      organizationId?: string;
      tenantOrg?: TenantOrg;
    }
  }
}
