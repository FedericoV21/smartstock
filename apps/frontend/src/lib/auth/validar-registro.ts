export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return null;
}

export function validateRegistroCompleto(body: Record<string, unknown>) {
  const negocio = String(body.negocio ?? '').trim();
  const nombre = String(body.nombre ?? '').trim();
  const apellido = String(body.apellido ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (!negocio) return { error: 'El nombre del negocio es obligatorio.' };
  if (!nombre) return { error: 'El nombre es obligatorio.' };
  if (!apellido) return { error: 'El apellido es obligatorio.' };
  if (!email || !EMAIL_RE.test(email)) {
    return { error: 'Ingresá un correo electrónico válido.' };
  }
  if (password.length < 6) {
    return { error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  return { negocio, nombre, apellido, email, password };
}

export function validateTenantSetup(body: Record<string, unknown>) {
  const negocio = String(body.negocio ?? '').trim();
  const nombre = String(body.nombre ?? '').trim();
  const apellido = String(body.apellido ?? '').trim();

  if (!negocio) return { error: 'El nombre del negocio es obligatorio.' };
  if (!nombre) return { error: 'El nombre es obligatorio.' };
  if (!apellido) return { error: 'El apellido es obligatorio.' };

  return { negocio, nombre, apellido };
}

export function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes('already registered') ||
    m.includes('already been registered') ||
    m.includes('user already exists')
  ) {
    return 'Ese correo ya está registrado.';
  }
  return message;
}
