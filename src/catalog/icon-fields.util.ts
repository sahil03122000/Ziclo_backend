// Shared by CatalogServicesService, PropertyTypesService, and PackagesService — an
// unchanged icon (frontend re-submits the current value, or omits it, or sends null/'' when
// the user didn't touch the icon picker) must never overwrite the existing iconName/iconUrl.
// Only a genuinely non-blank value is ever written; anything falsy is dropped from the
// returned object entirely so Prisma leaves the existing column untouched.
export function pickIconFields(input: {
  iconName?: string | null;
  iconUrl?: string | null;
}): { iconName?: string; iconUrl?: string } {
  const iconName = input.iconName?.trim();
  const iconUrl = input.iconUrl?.trim();
  return {
    ...(iconName ? { iconName } : {}),
    ...(iconUrl ? { iconUrl } : {}),
  };
}

// For call sites that spread a whole DTO wholesale into a Prisma `data` object (rather than
// building it field-by-field) — same rule, applied to the entire object at once.
export function withSafeIconFields<T extends { iconName?: string | null; iconUrl?: string | null }>(
  input: T,
): Omit<T, 'iconName' | 'iconUrl'> & { iconName?: string; iconUrl?: string } {
  const { iconName, iconUrl, ...rest } = input;
  return { ...rest, ...pickIconFields({ iconName, iconUrl }) };
}
