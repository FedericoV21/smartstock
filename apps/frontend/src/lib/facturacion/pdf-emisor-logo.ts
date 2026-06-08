import type jsPDF from 'jspdf';

const LOGO_MAX_W_MM = 48;
const LOGO_MAX_H_MM = 22;

/**
 * Descarga la imagen del tenant y la devuelve como data URL para jsPDF (solo http/https).
 */
/** Versión para navegador (reportes PDF en cliente). */
export async function fetchLogoDataUrlForPdfClient(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (logoUrl == null || typeof logoUrl !== 'string') return null;
  const u = logoUrl.trim();
  if (!u) return null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  try {
    const res = await fetch(u, { redirect: 'follow' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 2_000_000) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function fetchLogoDataUrlForPdf(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (logoUrl == null || typeof logoUrl !== 'string') return null;
  const u = logoUrl.trim();
  if (!u) return null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_000_000) return null;
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    let mime = 'image/png';
    if (ct === 'image/jpeg' || ct === 'image/jpg') mime = 'image/jpeg';
    else if (ct === 'image/png') mime = 'image/png';
    else if (ct === 'image/webp') mime = 'image/webp';
    else if (ct === 'image/gif') mime = 'image/gif';
    else {
      const low = u.toLowerCase();
      if (low.endsWith('.jpg') || low.endsWith('.jpeg')) mime = 'image/jpeg';
      else if (low.endsWith('.png')) mime = 'image/png';
      else if (low.endsWith('.webp')) mime = 'image/webp';
      else if (low.endsWith('.gif')) mime = 'image/gif';
    }
    const b64 = buf.toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatoAddImageDesdeDataUrl(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'JPEG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  if (dataUrl.includes('image/gif')) return 'PNG';
  return 'PNG';
}

/**
 * Dibuja el logo del emisor si hay `logo_data_url` válido. Devuelve dimensiones en mm o null.
 */
export function medirYdibujarLogoEmisor(
  doc: jsPDF,
  logoDataUrl: string | null | undefined,
  x: number,
  y: number,
): { width: number; height: number } | null {
  const raw = logoDataUrl?.trim();
  if (!raw || !raw.startsWith('data:')) return null;
  try {
    const props = doc.getImageProperties(raw);
    const iw = props.width;
    const ih = props.height;
    if (!iw || !ih) return null;
    let drawW = LOGO_MAX_W_MM;
    let drawH = (ih / iw) * drawW;
    if (drawH > LOGO_MAX_H_MM) {
      drawH = LOGO_MAX_H_MM;
      drawW = (iw / ih) * drawH;
    }
    const fmt = formatoAddImageDesdeDataUrl(raw);
    doc.addImage(raw, fmt, x, y, drawW, drawH);
    return { width: drawW, height: drawH };
  } catch {
    return null;
  }
}
