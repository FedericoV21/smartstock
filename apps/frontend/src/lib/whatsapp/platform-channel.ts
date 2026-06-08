export type WhatsAppPlatformChannel = {
  id: string;
  phoneNumberId: string;
  activa: boolean;
};

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

export async function getWhatsAppPlatformChannel(db: any): Promise<WhatsAppPlatformChannel | null> {
  const envPhoneNumberId = getWhatsAppPlatformPhoneNumberIdFromEnv();
  if (envPhoneNumberId) {
    return {
      id: 'env',
      phoneNumberId: envPhoneNumberId,
      activa: true,
    };
  }

  const { data, error } = await db
    .from('whatsapp_platform_channel' as any)
    .select('id, phone_number_id, activa')
    .eq('activa', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const phoneNumberId = normalizeWhatsAppPhoneNumberId(data?.phone_number_id);
  if (!data?.id || !phoneNumberId) return null;

  return {
    id: String(data.id),
    phoneNumberId,
    activa: Boolean(data.activa),
  };
}

export async function getWhatsAppPlatformPhoneNumberId(db: any): Promise<string | null> {
  const channel = await getWhatsAppPlatformChannel(db);
  return channel?.activa ? channel.phoneNumberId : null;
}

export function isWhatsAppPlatformPhoneNumberId(
  phoneNumberId: string | null | undefined,
  platformPhoneNumberId: string | null | undefined,
): boolean {
  const inbound = normalizeWhatsAppPhoneNumberId(phoneNumberId);
  const platform = normalizeWhatsAppPhoneNumberId(platformPhoneNumberId);
  return Boolean(inbound && platform && inbound === platform);
}
