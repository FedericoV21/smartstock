export type TenantEmisorTicket = {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  domicilio: string | null;
  logo_url: string | null;
};

export type SucursalEmisorTicket = {
  nombre: string;
  direccion: string | null;
  hereda_datos_ticket: boolean;
  razon_social: string | null;
  cuit: string | null;
  telefono: string | null;
  horarios_atencion: string | null;
  email: string | null;
};

function pickStr(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s) return s;
  }
  return '';
}

export function resolveEmisorTicket(
  tenant: TenantEmisorTicket,
  sucursal: SucursalEmisorTicket | null,
): {
  nombre_ticket: string;
  cuit: string | null;
  domicilio: string | null;
  logo_url: string | null;
} {
  const logo = tenant.logo_url?.trim() || null;

  if (!sucursal || sucursal.hereda_datos_ticket) {
    const nombre = pickStr(tenant.razon_social, tenant.nombre);
    const dom = pickStr(tenant.domicilio, sucursal?.direccion);
    return {
      nombre_ticket: nombre || tenant.nombre,
      cuit: tenant.cuit?.trim() || null,
      domicilio: dom || null,
      logo_url: logo,
    };
  }

  const nombre = pickStr(sucursal.razon_social, sucursal.nombre, tenant.razon_social, tenant.nombre);
  const dom = pickStr(sucursal.direccion, tenant.domicilio);
  const cuit = pickStr(sucursal.cuit, tenant.cuit) || null;

  return {
    nombre_ticket: nombre || tenant.nombre,
    cuit,
    domicilio: dom || null,
    logo_url: logo,
  };
}
