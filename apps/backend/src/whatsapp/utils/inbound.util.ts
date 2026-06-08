import { createHash } from 'node:crypto';

export interface WhatsAppInboundMessage {
  messageId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  messageType: string;
  textBody: string | null;
  metadata: Record<string, unknown>;
  messageRaw: Record<string, unknown>;
  attachment:
    | {
        mediaId: string | null;
        mimeType: string | null;
        filename: string | null;
        sha256: string;
        raw: Record<string, unknown>;
      }
    | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function attachmentFromMessage(message: Record<string, unknown>): WhatsAppInboundMessage['attachment'] {
  const messageType = asString(message.type);
  if (!messageType) return null;

  const attachmentKey = messageType === 'voice' ? 'audio' : messageType;
  const attachmentPayload = toRecord(message[attachmentKey]);
  if (messageType !== 'document' && messageType !== 'image' && messageType !== 'audio' && messageType !== 'voice')
    return null;
  if (Object.keys(attachmentPayload).length === 0) return null;

  const rawForHash = JSON.stringify(attachmentPayload);
  const sha256 = createHash('sha256').update(rawForHash).digest('hex');
  const fallbackFilename =
    messageType === 'audio' || messageType === 'voice' ? `voice-note-${sha256.slice(0, 8)}.ogg` : null;

  return {
    mediaId: asString(attachmentPayload.id),
    mimeType: asString(attachmentPayload.mime_type),
    filename: asString(attachmentPayload.filename) ?? fallbackFilename,
    sha256,
    raw: attachmentPayload,
  };
}

export function parseWhatsAppInboundPayload(payload: unknown): WhatsAppInboundMessage[] {
  const root = toRecord(payload);
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const parsed: WhatsAppInboundMessage[] = [];

  for (const entry of entries) {
    const entryRecord = toRecord(entry);
    const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];

    for (const change of changes) {
      const changeRecord = toRecord(change);
      const value = toRecord(changeRecord.value);
      const metadata = toRecord(value.metadata);
      const phoneNumberId = asString(metadata.phone_number_id);
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const message of messages) {
        const messageRecord = toRecord(message);
        const messageId = asString(messageRecord.id);
        const fromWaId = asString(messageRecord.from);
        const messageType = asString(messageRecord.type);
        if (!messageId || !fromWaId || !messageType) continue;

        const text = toRecord(messageRecord.text);
        parsed.push({
          messageId,
          fromWaId,
          phoneNumberId,
          messageType,
          textBody: asString(text.body),
          metadata,
          messageRaw: messageRecord,
          attachment: attachmentFromMessage(messageRecord),
        });
      }
    }
  }

  return parsed;
}

const MEDIA_FIRST_TYPES = new Set(['image', 'document', 'audio', 'voice']);

export function sortInboundMessagesForBranchHandling(
  messages: WhatsAppInboundMessage[],
): WhatsAppInboundMessage[] {
  return [...messages].sort((a, b) => {
    const aMedia = MEDIA_FIRST_TYPES.has(a.messageType) || Boolean(a.attachment);
    const bMedia = MEDIA_FIRST_TYPES.has(b.messageType) || Boolean(b.attachment);
    if (aMedia === bMedia) return 0;
    return aMedia ? -1 : 1;
  });
}
