/**
 * Approximate token count assuming ~4 chars/token (tuned to English).
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks of approximately `targetTokens` tokens with `overlapTokens`
 * of overlap. We split by paragraphs first, then by sentences, then by hard wrap.
 */
export function chunkText(
  text: string,
  targetTokens = 1000,
  overlapTokens = 100
): string[] {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= targetChars) return [cleaned];

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 <= targetChars) {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = tail ? `${tail}\n\n${para}` : para;
    } else {
      buffer = para;
    }

    while (buffer.length > targetChars) {
      const slice = buffer.slice(0, targetChars);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? ")
      );
      const cut = lastBreak > targetChars * 0.5 ? lastBreak + 1 : targetChars;
      chunks.push(buffer.slice(0, cut).trim());
      buffer = buffer.slice(Math.max(0, cut - overlapChars));
    }
  }

  if (buffer.trim().length > 0) chunks.push(buffer.trim());
  return chunks;
}
