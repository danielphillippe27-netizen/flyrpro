// lib/geminiImageService.ts

import { getGeminiModel } from "./googleGemini";

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

  // Get Gemini model using SDK
  const model = getGeminiModel("gemini-3-pro-image-preview");

  try {
    // Generate content using SDK (can pass string directly)
    const result = await model.generateContent(fullPrompt);

    const candidates = result.response.candidates ?? [];
    if (!candidates.length || !candidates[0]?.content?.parts) {
      throw new Error('Invalid Gemini response: no candidates/parts');
    }

    // Find inline image data in parts
    const parts = candidates[0].content.parts ?? [];
    const inlinePart = parts.find((p: any) => p.inlineData?.data);

    if (!inlinePart) {
      throw new Error('No image data found in Gemini response');
    }

    const base64 = inlinePart.inlineData.data as string;
    const mime = (inlinePart.inlineData.mimeType as string) || 'image/png';
    return `data:${mime};base64,${base64}`;
  } catch (error) {
    if (error instanceof Error) {
      console.error('Gemini image generation error:', {
        message: error.message,
        stack: error.stack,
        error,
      });
      throw error;
    }
    throw new Error(`Failed to generate Gemini image: ${String(error)}`);
  }
}


