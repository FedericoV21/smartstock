import { fetchLogoDataUrlForPdfClient } from '@/lib/facturacion/pdf-emisor-logo';
import type { EmisorPdfInforme } from '@/lib/reportes/pdf-informe';

export async function fetchEmisorParaPdfInforme(): Promise<EmisorPdfInforme | null> {
  const res = await fetch('/api/configuracion/tenant', { cache: 'no-store' });
  if (!res.ok) return null;
  const tenant = (await res.json()) as {
    nombre?: string | null;
    razon_social?: string | null;
    cuit?: string | null;
    domicilio?: string | null;
    logo_url?: string | null;
    error?: string;
  };
  if (tenant.error) return null;

  const logoDataUrl = await fetchLogoDataUrlForPdfClient(tenant.logo_url);
  const nombre = String(tenant.razon_social || tenant.nombre || 'Negocio').trim();

  return {
    nombre,
    razonSocial: tenant.razon_social?.trim() || null,
    cuit: tenant.cuit?.trim() || null,
    domicilio: tenant.domicilio?.trim() || null,
    logoDataUrl,
  };
}
