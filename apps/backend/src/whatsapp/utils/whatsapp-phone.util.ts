export function normalizeWhatsAppPhoneNumberId(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\D/g, '');
}

export function getWhatsAppPlatformPhoneNumberIdFromEnv(): string | null {
  const raw = (
    process.env.WHATSAPP_PLATFORM_PHONE_NUMBER_ID ??
    process.env.WHATSAPP_PHONE_NUMBER_ID ??
    process.env.ID_WHATSAPP_NUMBER ??
    ''
  ).trim();
  const normalized = normalizeWhatsAppPhoneNumberId(raw);
  return normalized || null;
}
