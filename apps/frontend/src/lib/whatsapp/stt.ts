type SttProvider = 'openai' | 'disabled';

function getProvider(): SttProvider {
  const provider = (process.env.WHATSAPP_STT_PROVIDER ?? 'openai').trim().toLowerCase();
  if (provider === 'openai') return 'openai';
  return 'disabled';
}

function normalizeAudioExtension(mimeType: string | null, filename: string): string {
  const lower = (mimeType ?? '').toLowerCase();
  if (lower.includes('ogg') || lower.includes('opus')) return `${filename}.ogg`;
  if (lower.includes('mpeg') || lower.includes('mp3')) return `${filename}.mp3`;
  if (lower.includes('wav')) return `${filename}.wav`;
  if (lower.includes('webm')) return `${filename}.webm`;
  if (lower.includes('mp4')) return `${filename}.m4a`;
  return `${filename}.audio`;
}

function requiredOpenAiApiKey(): string {
  const key = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!key) {
    throw new Error('OPENAI_API_KEY no configurada para transcripción de audio.');
  }
  return key;
}

function transcriptionEndpoint(): string {
  return (process.env.OPENAI_AUDIO_TRANSCRIPTIONS_URL ?? 'https://api.openai.com/v1/audio/transcriptions').trim();
}

function transcriptionModel(): string {
  return (process.env.OPENAI_AUDIO_TRANSCRIPTIONS_MODEL ?? 'gpt-4o-mini-transcribe').trim();
}

export async function transcribeWhatsAppAudio(params: {
  bytes: ArrayBuffer;
  mimeType: string | null;
  filename: string | null;
}) {
  const provider = getProvider();
  if (provider === 'disabled') {
    throw new Error('WHATSAPP_STT_PROVIDER deshabilitado. No se puede transcribir audio.');
  }

  const apiKey = requiredOpenAiApiKey();
  const endpoint = transcriptionEndpoint();
  const model = transcriptionModel();

  const guessedName = normalizeAudioExtension(params.mimeType, (params.filename ?? 'whatsapp-audio').replace(/\s+/g, '-'));
  const blob = new Blob([params.bytes], { type: params.mimeType ?? 'application/octet-stream' });
  const form = new FormData();
  form.append('model', model);
  form.append('language', 'es');
  form.append('response_format', 'json');
  form.append('file', blob, guessedName);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`STT provider error (${response.status}): ${body.slice(0, 240)}`);
  }

  const json = (await response.json()) as { text?: string };
  const text = String(json.text ?? '').trim();
  if (!text) {
    throw new Error('La transcripción vino vacía.');
  }

  return {
    text,
    provider,
    model,
  };
}
