'use client';

import { Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { notifyModulosRefresh } from '@/hooks/useModulos';
import { createBrowserClient } from '@/lib/supabase/client';

const HOME_VALUE = '__mi_cuenta__';

type TenantOption = { id: string; nombre: string; cuit: string | null };

export function SuperAdminTenantSwitcher({
  homeTenantId,
  effectiveTenantId,
  homeTenantName,
}: {
  homeTenantId: string;
  effectiveTenantId: string;
  homeTenantName: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const actingElsewhere = effectiveTenantId !== homeTenantId;
  const selectValue = actingElsewhere ? effectiveTenantId : HOME_VALUE;

  const loadTenants = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tenants-accesibles');
      const json = (await res.json()) as { tenants?: TenantOption[]; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cargar la lista');
        setTenants([]);
        return;
      }
      setTenants(json.tenants ?? []);
    } catch {
      setError('Error de red');
      setTenants([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  async function switchTo(tenantId: string | null) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/cambiar-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'No se pudo cambiar');
        return;
      }
      const supabase = createBrowserClient();
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        setError(refreshErr.message);
        return;
      }
      notifyModulosRefresh();
      router.refresh();
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }

  const filtered = tenants.filter((t) => t.id !== homeTenantId);

  return (
    <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (!v || loading) return;
            if (v === HOME_VALUE) void switchTo(null);
            else void switchTo(v);
          }}
          disabled={loading || listLoading}
        >
          <SelectTrigger className="h-8 w-[min(14rem,70vw)] text-xs">
            <SelectValue placeholder="Cuenta activa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={HOME_VALUE}>{homeTenantName} (mi cuenta)</SelectItem>
            {filtered.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
                {t.cuit ? ` · ${t.cuit}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? <p className="max-w-[14rem] text-[10px] text-destructive">{error}</p> : null}
      {actingElsewhere ? (
        <span className="max-w-[14rem] truncate text-[10px] text-amber-700 dark:text-amber-500">
          Actuando como otra cuenta
        </span>
      ) : null}
    </div>
  );
}
