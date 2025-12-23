// app/api/ai-flyer/image/route.ts
import { NextResponse } from 'next/server';
import { generateGeminiImage } from '@/lib/geminiImageService';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      prompt,
      size = '1K',
      aspectRatio = '3:4',
    } = body as {
      prompt?: string;
      size?: '1K' | '2K' | '4K';
      aspectRatio?: '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
    };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'prompt' in request body" },
        { status: 400 }
      );
    }

    const imageUrl = await generateGeminiImage({
      prompt: prompt.trim(),
      size,
      aspectRatio,
    });

    return NextResponse.json({ imageUrl }, { status: 200 });
  } catch (err: any) {
    console.error('Flyer image generation error:', err);
    return NextResponse.json(
      {
        error:
          err?.message ??
          'Failed to generate flyer image. Please try again in a moment.',
      },
      { status: 500 }
    );
  }
}






