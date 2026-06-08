/** Rutas donde el usuario termina un flujo de correo (recovery, invitación) y debe poder fijar contraseña. */
export const AUTH_COMPLETION_PATH_PREFIXES = [
  '/recuperar-contrasena/nueva',
  '/invitacion/completar',
] as const;

export function isAuthCompletionPath(pathname: string): boolean {
  return AUTH_COMPLETION_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Destino por defecto tras verificar el enlace del correo, según el tipo de OTP. */
export function defaultNextAfterEmailLink(type: string | null): string {
  if (type === 'recovery') return '/recuperar-contrasena/nueva';
  if (type === 'invite') return '/invitacion/completar';
  return '/';
}
