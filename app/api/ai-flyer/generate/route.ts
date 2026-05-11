import { NextRequest, NextResponse } from 'next/server';
import {
  generateFlyerDesigns,
  type FlyerGenerationRequest,
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

    // Normalize and map the request body to FlyerGenerationRequest
    // Map "bold-colorful" style to "bold-color" for API
    const normalizedStyle =
      body.style === 'bold-colorful' ? 'bold-color' : body.style;

    const payload: FlyerGenerationRequest = {
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

    // Call AI service with enhanced error handling
    try {
      const result = await generateFlyerDesigns(payload);

      return NextResponse.json(
        {
          designs: result.designs,
        },
        { status: 200 }
      );
    } catch (apiError: unknown) {
      const serviceError = apiError as {
        message?: string;
        stack?: string;
        response?: { data?: unknown } | unknown;
      };
      // Log detailed error for debugging, including full Gemini error response
      console.error('AI service error:', {
        message: serviceError.message,
        stack: serviceError.stack,
        response:
          serviceError.response && typeof serviceError.response === 'object' && 'data' in serviceError.response
            ? serviceError.response.data
            : serviceError.response,
        payload: { ...payload, mediaUrls: payload.mediaUrls?.length || 0 },
        fullError: apiError,
      });

      // Return user-friendly error
      const errorMessage =
        apiError instanceof Error
          ? apiError.message
          : 'Failed to contact AI service';

      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    // Catch-all for unexpected errors
    console.error('AI flyer generation error:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : 'Failed to generate AI flyer. Please try again.',
      },
      { status: 500 }
    );
  }
}
