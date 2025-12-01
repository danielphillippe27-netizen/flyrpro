// lib/geminiImageService.ts

type GenerateGeminiImageParams = {
  prompt: string;
  size?: '1K' | '2K' | '4K';
  aspectRatio?: '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
};

/**
 * Server-side helper to call Gemini 3 Pro Image Preview
 * and return a data: URL (base64) for the generated image.
 */
export async function generateGeminiImage({
  prompt,
  size = '1K',
  aspectRatio = '3:4',
}: GenerateGeminiImageParams): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment variables');
  }

  const model = 'gemini-3-pro-image-preview';

  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

  // Encode size + aspect in the prompt so we don't rely on any
  // unstable imageConfig fields in the REST API.
  const fullPrompt = `
You are an AI designer generating a marketing flyer image.

Details:
- Base prompt: ${prompt}
- Desired resolution tier: ${size}
- Desired aspect ratio: ${aspectRatio}
- Style: clean, modern, real-estate flyer, bold headline space, room for copy and QR code, high contrast, readable layout.

Return a single high-quality PNG image.
`.trim();

  const body = {
    contents: [
      {
        parts: [{ text: fullPrompt }],
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini image error ${res.status} - ${text}`);
  }

  const json = await res.json();

  const candidates = json.candidates;
  if (!candidates || !candidates[0]?.content?.parts) {
    throw new Error('Invalid Gemini response: no candidates/parts');
  }

  for (const part of candidates[0].content.parts) {
    if (part.inlineData?.data) {
      const base64 = part.inlineData.data as string;
      const mime = (part.inlineData.mimeType as string) || 'image/png';
      return `data:${mime};base64,${base64}`;
    }
  }

  throw new Error('No image data found in Gemini response');
}


