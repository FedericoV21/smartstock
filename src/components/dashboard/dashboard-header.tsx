'use client';

import { Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SuperAdminTenantSwitcher } from '@/components/dashboard/super-admin-tenant-switcher';
import { Button } from '@/components/ui/button';
import { createBrowserClient } from '@/lib/supabase/client';

export function DashboardHeader({
  userDisplayName,
  onMenuClick,
  hideMobileMenu = false,
  isSuperAdmin = false,
  homeTenantId = '',
  effectiveTenantId = '',
  homeTenantName = '',
}: {
  userDisplayName: string;
  onMenuClick: () => void;
  hideMobileMenu?: boolean;
  isSuperAdmin?: boolean;
  homeTenantId?: string;
  effectiveTenantId?: string;
  homeTenantName?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      const supabase = createBrowserClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <header className="flex h-24 items-center gap-3 border-b bg-card px-4 md:px-6">
      {!hideMobileMenu ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          aria-label="Abrir menú"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>
      ) : (
        <div className="w-10 shrink-0 md:hidden" aria-hidden />
      )}
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">
        <span className="truncate font-medium text-foreground">{userDisplayName}</span>
      </div>
      {isSuperAdmin && homeTenantId && effectiveTenantId ? (
        <SuperAdminTenantSwitcher
          homeTenantId={homeTenantId}
          effectiveTenantId={effectiveTenantId}
          homeTenantName={homeTenantName || 'Mi cuenta'}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleLogout}
        disabled={loading}
      >
        {loading ? 'Cerrando…' : 'Cerrar sesión'}
      </Button>
    </header>
  );
}
