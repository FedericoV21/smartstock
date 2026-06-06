export function visionMaxOutputTokens(): number {
  const n = Number(process.env.IA_VISION_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(n) && n >= 1024) return Math.min(Math.floor(n), 131072);
  return 32768;
}
