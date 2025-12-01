// app/api/test-models/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.NANO_BANANA_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // List all available models
    const listModelsUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    
    const response = await fetch(listModelsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { 
          error: `Failed to list models: ${response.status}`,
          details: errorText 
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Filter to only models that support generateContent
    const generateContentModels = data.models?.filter((model: any) => 
      model.supportedGenerationMethods?.includes('generateContent')
    ) || [];

    return NextResponse.json({
      totalModels: data.models?.length || 0,
      generateContentModels: generateContentModels.map((model: any) => ({
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        supportedMethods: model.supportedGenerationMethods,
      })),
      allModels: data.models?.map((model: any) => ({
        name: model.name,
        displayName: model.displayName,
        supportedMethods: model.supportedGenerationMethods,
      })) || [],
    });
  } catch (error: any) {
    console.error('Error listing models:', error);
    return NextResponse.json(
      { 
        error: 'Failed to list models',
        message: error?.message 
      },
      { status: 500 }
    );
  }
}

