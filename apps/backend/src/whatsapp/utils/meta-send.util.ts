function fallbackWaIdForArgentina(toWaId: string): string | null {
  const digits = toWaId.replace(/\D/g, '');
  if (/^549\d{8,}$/.test(digits)) {
    return `54${digits.slice(3)}`;
  }
  return null;
}

type SendAttemptResult = {
  ok: boolean;
  status: number;
  rawText: string;
  parsed: unknown;
  externalMessageId: string | null;
};

async function sendMetaPayload(params: {
  endpoint: string;
  token: string;
  payload: Record<string, unknown>;
}): Promise<SendAttemptResult> {
  const response = await fetch(params.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.payload),
    cache: 'no-store',
  });

  const rawText = await response.text().catch(() => '');
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  const messages = (parsed as { messages?: Array<{ id?: string }> } | null)?.messages;
  const externalMessageId = Array.isArray(messages) ? String(messages[0]?.id ?? '') : '';
  return {
    ok: response.ok,
    status: response.status,
    rawText,
    parsed,
    externalMessageId: externalMessageId || null,
  };
}

function metaTextPayload(params: { toWaId: string; body: string }): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.toWaId,
    type: 'text',
    text: { body: params.body },
  };
}

function metaDocumentPayload(params: {
  toWaId: string;
  link: string;
  filename?: string | null;
  caption?: string | null;
}): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.toWaId,
    type: 'document',
    document: {
      link: params.link,
      ...(params.filename ? { filename: params.filename } : {}),
      ...(params.caption ? { caption: params.caption } : {}),
    },
  };
}

async function sendWithArgentinaFallback(params: {
  endpoint: string;
  token: string;
  toWaId: string;
  buildPayload: (toWaId: string) => Record<string, unknown>;
}) {
  const firstAttempt = await sendMetaPayload({
    endpoint: params.endpoint,
    token: params.token,
    payload: params.buildPayload(params.toWaId),
  });
  if (firstAttempt.ok) {
    return {
      externalMessageId: firstAttempt.externalMessageId,
      raw: firstAttempt.parsed,
      resolvedToWaId: params.toWaId,
    };
  }

  const errorCode = Number((firstAttempt.parsed as { error?: { code?: number } } | null)?.error?.code ?? 0);
  const fallbackWaId = fallbackWaIdForArgentina(params.toWaId);
  if (errorCode === 131030 && fallbackWaId && fallbackWaId !== params.toWaId) {
    const fallbackAttempt = await sendMetaPayload({
      endpoint: params.endpoint,
      token: params.token,
      payload: params.buildPayload(fallbackWaId),
    });
    if (fallbackAttempt.ok) {
      return {
        externalMessageId: fallbackAttempt.externalMessageId,
        raw: fallbackAttempt.parsed,
        resolvedToWaId: fallbackWaId,
      };
    }
    throw new Error(
      `Meta send message error (${fallbackAttempt.status}): ${fallbackAttempt.rawText.slice(0, 300)}`,
    );
  }

  throw new Error(`Meta send message error (${firstAttempt.status}): ${firstAttempt.rawText.slice(0, 300)}`);
}

export async function sendWhatsAppTextMessage(params: {
  accessToken: string;
  apiVersion: string;
  phoneNumberId: string;
  toWaId: string;
  body: string;
}) {
  const endpoint = `https://graph.facebook.com/${params.apiVersion}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  return sendWithArgentinaFallback({
    endpoint,
    token: params.accessToken,
    toWaId: params.toWaId,
    buildPayload: (toWaId) => metaTextPayload({ toWaId, body: params.body }),
  });
}

export async function sendWhatsAppDocumentMessage(params: {
  accessToken: string;
  apiVersion: string;
  phoneNumberId: string;
  toWaId: string;
  link: string;
  filename?: string | null;
  caption?: string | null;
}) {
  const endpoint = `https://graph.facebook.com/${params.apiVersion}/${encodeURIComponent(params.phoneNumberId)}/messages`;
  return sendWithArgentinaFallback({
    endpoint,
    token: params.accessToken,
    toWaId: params.toWaId,
    buildPayload: (toWaId) =>
      metaDocumentPayload({
        toWaId,
        link: params.link,
        filename: params.filename,
        caption: params.caption,
      }),
  });
}
