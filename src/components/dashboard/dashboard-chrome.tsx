'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Brain,
  ChevronDown,
  Contact,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FolderTree,
  LayoutDashboard,
  Package,
  ScanBarcode,
  Settings,
  Truck,
  Upload,
  Users,
  UsersRound,
  Warehouse,
  X,
} from 'lucide-react';

import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { DashboardRoleProvider } from '@/components/dashboard/dashboard-role-context';
import { useModulos } from '@/hooks/useModulos';
import type { ModuloKey, ModulosConfig } from '@/lib/modulos/modulo-key';
import { cn } from '@/lib/utils';

type IconType = React.ComponentType<{ className?: string }>;

type NavLeaf = {
  type: 'leaf';
  label: string;
  href: string;
  icon: IconType;
  modulo?: ModuloKey;
  adminOnly?: boolean;
};

type NavGroup = {
  type: 'group';
  key: string;
  label: string;
  icon: IconType;
  items: NavLeaf[];
};

type NavEntry = NavLeaf | NavGroup;

const NAV_ENTRIES: NavEntry[] = [
  { type: 'leaf', label: 'Dashboard', href: '/', icon: LayoutDashboard },
  {
    type: 'group',
    key: 'inventario',
    label: 'Inventario',
    icon: Warehouse,
    items: [
      { type: 'leaf', label: 'Productos', href: '/productos', icon: Package, modulo: 'stock' },
      { type: 'leaf', label: 'Categorías', href: '/categorias', icon: FolderTree, modulo: 'stock' },
      { type: 'leaf', label: 'Movimientos', href: '/movimientos', icon: ArrowLeftRight, modulo: 'stock' },
    ],
  },
  {
    type: 'group',
    key: 'importar',
    label: 'Importar',
    icon: Upload,
    items: [
      { type: 'leaf', label: 'Importar', href: '/importar', icon: Upload, modulo: 'importador_excel' },
      { type: 'leaf', label: 'IA Precios', href: '/ia-precios', icon: Brain, modulo: 'ia_precios' },
    ],
  },
  {
    type: 'group',
    key: 'contactos',
    label: 'Contactos',
    icon: Contact,
    items: [
      { type: 'leaf', label: 'Proveedores', href: '/proveedores', icon: Truck, modulo: 'stock' },
      { type: 'leaf', label: 'Clientes', href: '/clientes', icon: Users, modulo: 'facturador_simple' },
    ],
  },
  {
    type: 'group',
    key: 'facturacion',
    label: 'Facturación',
    icon: FileText,
    items: [
      { type: 'leaf', label: 'Facturación', href: '/facturacion', icon: FileText, modulo: 'facturador_simple' },
      { type: 'leaf', label: 'POS', href: '/facturacion/pos', icon: ScanBarcode, modulo: 'facturador_pos' },
    ],
  },
  { type: 'leaf', label: 'Presupuestos', href: '/presupuestos', icon: FileSpreadsheet, modulo: 'presupuestos' },
  { type: 'leaf', label: 'Analizador', href: '/analizador', icon: BarChart3, modulo: 'analizador_rentabilidad' },
  {
    type: 'group',
    key: 'configuracion',
    label: 'Configuración',
    icon: Settings,
    items: [
      { type: 'leaf', label: 'Mi negocio', href: '/configuracion', icon: Settings },
      { type: 'leaf', label: 'Usuarios', href: '/configuracion/usuarios', icon: UsersRound, adminOnly: true },
      { type: 'leaf', label: 'ARCA / AFIP', href: '/configuracion/arca', icon: FileText, modulo: 'facturador_arca' },
      { type: 'leaf', label: 'Plan y módulos', href: '/configuracion/plan', icon: CreditCard },
    ],
  },
];

function leafActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/facturacion') {
    return pathname === '/facturacion' || pathname.startsWith('/facturacion/arca');
  }
  if (href === '/configuracion') {
    return pathname === '/configuracion';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function leafVisible(leaf: NavLeaf, modulos: ModulosConfig, isAdmin: boolean) {
  if (leaf.adminOnly && !isAdmin) return false;
  if (!leaf.modulo) return true;
  return Boolean(modulos[leaf.modulo]);
}

type VisibleLeaf = { kind: 'leaf'; leaf: NavLeaf };
type VisibleGroup = { kind: 'group'; group: NavGroup; items: NavLeaf[] };
type VisibleEntry = VisibleLeaf | VisibleGroup;

function buildVisibleEntries(modulos: ModulosConfig, isAdmin: boolean): VisibleEntry[] {
  const result: VisibleEntry[] = [];
  for (const entry of NAV_ENTRIES) {
    if (entry.type === 'leaf') {
      if (leafVisible(entry, modulos, isAdmin)) {
        result.push({ kind: 'leaf', leaf: entry });
      }
      continue;
    }
    const items = entry.items.filter((leaf) => leafVisible(leaf, modulos, isAdmin));
    if (items.length === 0) continue;
    result.push({ kind: 'group', group: entry, items });
  }
  return result;
}

function SidebarNav({
  pathname,
  onNavigate,
  className,
  entries,
  openGroups,
  onToggleGroup,
}: {
  pathname: string;
  onNavigate?: () => void;
  className?: string;
  entries: VisibleEntry[];
  openGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
}) {
  return (
    <nav className={cn('flex flex-col gap-1 p-4', className)}>
      {entries.map((entry) => {
        if (entry.kind === 'leaf') {
          const { leaf } = entry;
          const Icon = leaf.icon;
          const active = leafActive(pathname, leaf.href);
          return (
            <Link
              key={leaf.href}
              href={leaf.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {leaf.label}
            </Link>
          );
        }

        const { group, items } = entry;
        const GroupIcon = group.icon;
        const hasActiveChild = items.some((leaf) => leafActive(pathname, leaf.href));
        const open = openGroups[group.key] ?? hasActiveChild;

        return (
          <div key={group.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => onToggleGroup(group.key)}
              aria-expanded={open}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                hasActiveChild
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <GroupIcon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 transition-transform duration-200',
                  open ? 'rotate-0' : '-rotate-90'
                )}
                aria-hidden
              />
            </button>
            {open ? (
              <div className="mt-1 flex flex-col gap-1 border-l border-border/60 pl-3 ml-4">
                {items.map((leaf) => {
                  const Icon = leaf.icon;
                  const active = leafActive(pathname, leaf.href);
                  return (
                    <Link
                      key={leaf.href}
                      href={leaf.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {leaf.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function SiteLogoLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/"
      className="flex w-full shrink-0 items-center justify-center"
      onClick={onClick}
    >
      <Image
        src="/nexus/nexus_logo.png"
        alt="Nexus Solutions Software"
        width={360}
        height={126}
        className="h-20 w-auto max-w-[min(280px,calc(100%-2rem))] object-contain object-center md:h-[5.5rem]"
        priority
      />
    </Link>
  );
}

export function DashboardChrome({
  userDisplayName,
  canEdit,
  isAdmin = false,
  isSuperAdmin = false,
  homeTenantId = '',
  effectiveTenantId = '',
  homeTenantName = '',
  setupMode = false,
  children,
}: {
  userDisplayName: string;
  canEdit: boolean;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  homeTenantId?: string;
  effectiveTenantId?: string;
  homeTenantName?: string;
  /** Pantalla inicial de negocio: sin menú lateral hasta completar datos. */
  setupMode?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '/';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { modulos, loading } = useModulos();

  const visibleEntries = useMemo(
    () => buildVisibleEntries(modulos, isAdmin),
    [modulos, isAdmin]
  );

  const handleToggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const currentEntry = visibleEntries.find(
        (entry): entry is VisibleGroup => entry.kind === 'group' && entry.group.key === key
      );
      const hasActiveChild = currentEntry
        ? currentEntry.items.some((leaf) => leafActive(pathname, leaf.href))
        : false;
      const currentlyOpen = prev[key] ?? hasActiveChild;
      return { ...prev, [key]: !currentlyOpen };
    });
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-muted/30">
      {!setupMode ? (
      <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
        <div className="flex h-24 items-center justify-center border-b px-4">
          <SiteLogoLink />
        </div>
        {loading ? (
          <div className="flex-1 animate-pulse p-4" aria-hidden />
        ) : (
          <SidebarNav
            pathname={pathname}
            className="flex-1 overflow-y-auto"
            entries={visibleEntries}
            openGroups={openGroups}
            onToggleGroup={handleToggleGroup}
          />
        )}
      </aside>
      ) : null}

      {!setupMode && mobileOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {!setupMode ? (
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r bg-card shadow-lg transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="relative flex h-24 items-center justify-center border-b px-4">
          <SiteLogoLink onClick={() => setMobileOpen(false)} />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar menú"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {loading ? (
          <div className="flex-1 animate-pulse p-4" aria-hidden />
        ) : (
          <SidebarNav
            pathname={pathname}
            className="flex-1 overflow-y-auto"
            onNavigate={() => setMobileOpen(false)}
            entries={visibleEntries}
            openGroups={openGroups}
            onToggleGroup={handleToggleGroup}
          />
        )}
      </aside>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <DashboardHeader
          userDisplayName={userDisplayName}
          onMenuClick={() => setMobileOpen(true)}
          hideMobileMenu={setupMode}
          isSuperAdmin={isSuperAdmin}
          homeTenantId={homeTenantId}
          effectiveTenantId={effectiveTenantId}
          homeTenantName={homeTenantName}
        />
        <main
          className={cn(
            'flex-1 overflow-x-hidden p-4 md:p-6',
            setupMode && 'flex flex-col items-center'
          )}
        >
          <DashboardRoleProvider canEdit={canEdit} isAdmin={isAdmin}>
            {children}
          </DashboardRoleProvider>
        </main>
      </div>
    </div>
  );
}
