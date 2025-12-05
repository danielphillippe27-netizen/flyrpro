import { NextRequest, NextResponse } from 'next/server';
import { uploadBackgroundRemovedImage } from '@/lib/flyers/uploadBackgroundRemovedImage';

/**
 * Background Remover API Route
 * 
 * Removes background from images using remove.bg API
 * and uploads the result to Supabase Storage.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { imageUrl } = body as { imageUrl?: string };

    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
      return NextResponse.json(
        { error: "Missing or invalid 'imageUrl' in request body" },
        { status: 400 }
      );
    }

    const apiKey = process.env.BG_REMOVER_API_KEY;
    if (!apiKey) {
      console.error('BG_REMOVER_API_KEY is not set');
      return NextResponse.json(
        { error: 'Background remover service is not configured' },
        { status: 500 }
      );
    }

    // Fetch the input image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch the input image' },
        { status: 400 }
      );
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    // Detect content type from response or default to jpeg
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const imageBlob = new Blob([imageBuffer], { type: contentType });

    // Call remove.bg API
    // Documentation: https://www.remove.bg/api
    const formData = new FormData();
    formData.append('image_file', imageBlob, 'image.jpg');
    formData.append('size', 'auto');

    const removeBgResponse = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
      },
      body: formData,
    });

    if (!removeBgResponse.ok) {
      const errorText = await removeBgResponse.text();
      console.error('remove.bg API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to remove background. Please try another image.' },
        { status: 500 }
      );
    }

    // Get the processed image (PNG with transparent background)
    const processedImageBlob = await removeBgResponse.blob();

    // Upload to Supabase Storage
    const publicUrl = await uploadBackgroundRemovedImage(processedImageBlob);

    return NextResponse.json({ url: publicUrl }, { status: 200 });
  } catch (err: any) {
    console.error('Background remover error:', err);
    return NextResponse.json(
      {
        error:
          err?.message ??
          'Failed to remove background. Please try again in a moment.',
      },
      { status: 500 }
    );
  }
}

