import { NextRequest, NextResponse } from 'next/server';
import {
  generateNanoBananaFlyers,
  type NanoBananaRequest,
} from '@/lib/nano-banana';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.orientation || !body.size || !body.finish || !body.campaignType) {
      return NextResponse.json(
        { error: 'Missing required fields: orientation, size, finish, campaignType' },
        { status: 400 }
      );
    }

    if (!body.cta || !body.brandColor || !body.style || !body.tone) {
      return NextResponse.json(
        { error: 'Missing required fields: cta, brandColor, style, tone' },
        { status: 400 }
      );
    }

    // Normalize and map the request body to NanoBananaRequest
    // Map "bold-colorful" style to "bold-color" for API
    const normalizedStyle =
      body.style === 'bold-colorful' ? 'bold-color' : body.style;

    const payload: NanoBananaRequest = {
      orientation: body.orientation as 'horizontal' | 'vertical',
      size: body.size,
      finish: body.finish as 'glossy' | 'matte',
      campaignType: body.campaignType as
        | 'just-listed'
        | 'just-sold'
        | 'open-house'
        | 'farming'
        | 'service-business',
      address: body.propertyAddress || body.address || undefined,
      price: body.price || undefined,
      beds: body.beds ? Number(body.beds) : null,
      baths: body.baths ? Number(body.baths) : null,
      sqft: body.sqft ? Number(body.sqft) : null,
      cta: body.cta,
      brandColor: body.brandColor,
      style: normalizedStyle as
        | 'clean-minimal'
        | 'bold-color'
        | 'luxury'
        | 'modern-gradient',
      tone: body.tone as 'professional' | 'friendly' | 'high-energy' | 'luxury',
      mediaUrls: body.mediaUrls || [],
    };

    // Call Nano Banana API
    const result = await generateNanoBananaFlyers(payload);

    return NextResponse.json(
      {
        designs: result.designs,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('AI flyer generation error:', error);

    // Provide user-friendly error message
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to generate AI flyer. Please try again.';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
