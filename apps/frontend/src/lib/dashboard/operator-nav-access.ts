/** Rutas de inventario habilitables para operadores con permiso stock. */
export const INVENTARIO_OPERATOR_HREFS = new Set([
  '/productos',
  '/categorias',
  '/productos/transferir',
]);

export type OperatorNavFlags = {
  puedeVerProveedoresContactos: boolean;
  puedeVerClientesContactos: boolean;
  puedeUsarInventario: boolean;
  puedeVerPromociones: boolean;
  puedeUsarDespiece: boolean;
};

export function operadorPuedeInventarioPath(pathname: string): boolean {
  if (INVENTARIO_OPERATOR_HREFS.has(pathname)) return true;
  if (pathname.startsWith('/productos/') && pathname !== '/productos/transferir') return true;
  if (pathname.startsWith('/categorias/')) return true;
  return false;
}

/** Punto de venta: siempre accesible para operador/cajero si el tenant tiene el módulo. */
export function operadorPuedeFacturacionPosPath(pathname: string): boolean {
  return pathname === '/facturacion/pos' || pathname.startsWith('/facturacion/pos/');
}

export function operadorPuedeDespiecePath(pathname: string): boolean {
  return pathname === '/despiece' || pathname.startsWith('/despiece/');
}

export function operadorPuedeAccederPath(pathname: string, flags: OperatorNavFlags): boolean {
  const baseAllowed =
    pathname === '/' ||
    pathname.startsWith('/turnos');

  if (baseAllowed) return true;
  if (operadorPuedeFacturacionPosPath(pathname)) return true;
  if (flags.puedeVerProveedoresContactos && pathname.startsWith('/proveedores')) return true;
  if (flags.puedeVerClientesContactos && pathname.startsWith('/cuenta-corriente')) return true;
  if (flags.puedeUsarInventario && operadorPuedeInventarioPath(pathname)) return true;
  if (flags.puedeVerPromociones && pathname.startsWith('/promociones')) return true;
  if (flags.puedeUsarDespiece && operadorPuedeDespiecePath(pathname)) return true;
  return false;
}

export function operadorPuedeLeafHref(href: string, flags: OperatorNavFlags): boolean {
  const OPERATOR_ALLOWED_HREFS = new Set([
    '/',
    '/turnos',
  ]);

  if (OPERATOR_ALLOWED_HREFS.has(href)) return true;
  if (href === '/facturacion/pos') return true;
  if (href === '/proveedores' && flags.puedeVerProveedoresContactos) return true;
  if (href === '/cuenta-corriente' && flags.puedeVerClientesContactos) return true;
  if (flags.puedeUsarInventario && INVENTARIO_OPERATOR_HREFS.has(href)) return true;
  if (flags.puedeVerPromociones && href === '/promociones') return true;
  if (flags.puedeUsarDespiece && href === '/despiece/plantillas') return true;
  return false;
}
