import { DashboardShell } from '@/components/dashboard/dashboard-shell';
import { getSessionProfile } from '@/lib/dashboard/session-profile';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getSessionProfile();
  const userDisplayName = profile?.userDisplayName ?? 'Usuario';
  const canEdit = profile ? profile.rol !== 'visor' : false;

  return (
    <DashboardShell
      userDisplayName={userDisplayName}
      canEdit={canEdit}
      isAdmin={profile?.rol === 'admin'}
      isSuperAdmin={profile?.isSuperAdmin ?? false}
      homeTenantId={profile?.homeTenantId ?? ''}
      effectiveTenantId={profile?.tenantId ?? ''}
      homeTenantName={profile?.homeTenantName ?? ''}
    >
      {children}
    </DashboardShell>
  );
}
