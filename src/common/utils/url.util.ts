// Normalizes a stored image reference into a complete, absolute URL. Most rows already hold
// a full URL (ImageUploadController bakes in BASE_URL at upload time), but this defensively
// covers any row that only holds a bare filename by reconstructing the same public path.
export function resolveImageUrl(
  value: string | null | undefined,
  baseUrl: string | undefined,
): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!baseUrl) return value;
  return `${baseUrl}/uploads/images/${value}`;
}
