function getAccessToken(): string {
  return (process.env.WHATSAPP_ACCESS_TOKEN ?? '').trim();
}

function getApiVersion(): string {
  return (process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v20.0').trim();
}

function getGraphBaseUrl(): string {
  return `https://graph.facebook.com/${getApiVersion()}`;
}

function requiredToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');
  }
  return token;
}

export async function fetchWhatsAppMediaMetadata(mediaId: string): Promise<{
  url: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
}> {
  const token = requiredToken();
  const response = await fetch(`${getGraphBaseUrl()}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Meta media metadata error (${response.status}): ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    url?: string;
    mime_type?: string;
    sha256?: string;
    file_size?: number;
  };

  if (!json.url) throw new Error('Meta media metadata sin url');
  return {
    url: json.url,
    mime_type: json.mime_type,
    sha256: json.sha256,
    file_size: json.file_size,
  };
}

export async function downloadWhatsAppMedia(mediaUrl: string): Promise<{
  bytes: ArrayBuffer;
  contentType: string | null;
  contentLength: number | null;
}> {
  const token = requiredToken();
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Meta media download error (${response.status}): ${body.slice(0, 200)}`);
  }

  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type');
  const lenHeader = response.headers.get('content-length');
  const contentLength = lenHeader ? Number.parseInt(lenHeader, 10) : null;

  return { bytes, contentType, contentLength: Number.isFinite(contentLength ?? NaN) ? contentLength : null };
}
