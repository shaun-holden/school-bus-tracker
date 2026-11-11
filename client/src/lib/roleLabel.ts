// Human label for a user role (Q30): "master_admin" -> "Master Admin".
const ROLE_LABELS: Record<string, string> = {
  parent: 'Parent',
  driver: 'Driver',
  admin: 'Admin',
  driver_admin: 'Driver Admin',
  master_admin: 'Master Admin',
};

export function formatRole(role: string | null | undefined): string {
  if (!role) return '';
  const known = ROLE_LABELS[role];
  if (known) return known;
  return role
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
