import { NextRequest, NextResponse } from 'next/server';
import { generateGeminiImage } from '@/lib/geminiImageService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
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

    return NextResponse.json({ data: { url: imageUrl } });
  } catch (error) {
    console.error('Editor AI image generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate image' },
      { status: 500 }
    );
  }
}
