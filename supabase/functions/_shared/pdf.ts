// Use unpdf — a serverless-friendly fork of pdf.js with no DOM dependencies.
// Docs: https://github.com/unjs/unpdf
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@1.6.0";

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

export async function extractPdfText(buffer: ArrayBuffer): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  return {
    text: text.trim(),
    pageCount: result.totalPages ?? pdf.numPages,
  };
}

/**
 * Detect if the file is plain text vs PDF based on its leading bytes.
 */
export function isPdfBuffer(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer.slice(0, 5));
  // %PDF-
  return (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  );
}

export async function extractTextFromBuffer(buffer: ArrayBuffer): Promise<ExtractedPdf> {
  if (isPdfBuffer(buffer)) {
    return await extractPdfText(buffer);
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { text: decoder.decode(buffer).trim(), pageCount: 1 };
}
