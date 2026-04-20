'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { DashboardChrome } from '@/components/dashboard/dashboard-chrome';

export function DashboardShell({
  userDisplayName,
  canEdit,
  isAdmin,
  isSuperAdmin,
  homeTenantId,
  effectiveTenantId,
  homeTenantName,
  children,
}: {
  userDisplayName: string;
  canEdit: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  homeTenantId: string;
  effectiveTenantId: string;
  homeTenantName: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  const setupMode = pathname === '/onboarding' || pathname.startsWith('/onboarding/');

  return (
    <DashboardChrome
      userDisplayName={userDisplayName}
      canEdit={canEdit}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      homeTenantId={homeTenantId}
      effectiveTenantId={effectiveTenantId}
      homeTenantName={homeTenantName}
      setupMode={setupMode}
    >
      {children}
    </DashboardChrome>
  );
}
