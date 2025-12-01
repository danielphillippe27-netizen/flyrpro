import { NextRequest, NextResponse } from "next/server";
import { FlyerTemplate, FlyerListingData } from "@/types/flyer";

const GEMINI_MODEL = "gemini-2.5-flash";

export async function POST(req: NextRequest) {
  try {
    const { listing, config, previousTemplate, revisionPrompt } = await req.json();

    const apiKey =
      process.env.GOOGLE_AI_STUDIO_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.NANO_BANANA_API_KEY;

    if (!apiKey) {
      console.error("Missing API key. Checked:", {
        GOOGLE_AI_STUDIO_API_KEY: !!process.env.GOOGLE_AI_STUDIO_API_KEY,
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        NANO_BANANA_API_KEY: !!process.env.NANO_BANANA_API_KEY,
      });
      return NextResponse.json(
        { 
          error: "Missing API key", 
          detail: "Please set GOOGLE_AI_STUDIO_API_KEY, GEMINI_API_KEY, or NANO_BANANA_API_KEY in your environment variables." 
        },
        { status: 500 }
      );
    }

    const systemPrompt = `
You are a senior graphic designer building JSON templates for real estate flyers.

Use this TypeScript interface:

\`\`\`
interface FlyerElement {
  type: "headline" | "subheadline" | "body" | "label" | "image" | "qr" | "shape";
  bind?: "status" | "address" | "price" | "bedsBaths" | "description" | "propertyPhoto" | "qrUrl";
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  color?: string;
  align?: "left" | "center" | "right";
  size?: number; // for QR codes
  shape?: "rect" | "ribbon"; // for shapes
  borderRadius?: number;
}

interface FlyerTemplate {
  id: string;
  name: string;
  size: "4x6" | "5x7" | "8.5x5.5";
  orientation: "horizontal" | "vertical";
  backgroundColor: string;
  brandColor: string;
  elements: FlyerElement[];
}
\`\`\`

You must output STRICT JSON that matches FlyerTemplate, with no comments or extra keys.

Coordinate system:
- x, y in pixels relative to top-left.
- Assume base canvas width 600px. For vertical flyers, height 900px; for horizontal, 420px.

Style guidelines:
- Use brandColor from the user.
- Ensure good contrast and modern real estate design.
- Large, legible headline for campaign status.
- Prominent property photo (if provided).
- Clear price & beds/baths line.
- QR code placed in a clean, scannable area (size 80-120px recommended).

Never include lorem ipsum; use bindings (status, address, price, bedsBaths, description) where possible.

For text elements:
- Headlines: fontSize 32-48px, bold, use brandColor or high contrast color
- Subheadlines: fontSize 20-28px
- Body text: fontSize 14-18px
- Labels: fontSize 12-14px

For images:
- Set bind to "propertyPhoto"
- Typical size: 300-400px width, 200-300px height
- Use borderRadius 8-16px for modern look

For QR codes:
- Set bind to "qrUrl"
- Size: 80-120px
- Place in bottom corner or prominent area

For shapes:
- Use for backgrounds, ribbons, or decorative elements
- Ribbons work well for status badges
    `.trim();

    const userContext = revisionPrompt
      ? `Revise this existing template according to the user request.

Revision request: ${revisionPrompt}

Existing template:
${JSON.stringify(previousTemplate, null, 2)}

Return the revised template as a complete FlyerTemplate JSON object.`
      : `Create a new flyer template for this listing and configuration:

Listing:
${JSON.stringify(listing, null, 2)}

Configuration:
${JSON.stringify(config, null, 2)}

Return one template object following the FlyerTemplate interface. Generate a unique id (UUID format) and a descriptive name.`;

    const body = {
      contents: [
        {
          parts: [{ text: systemPrompt + "\n\n" + userContext }],
        },
      ],
    };

    // Use v1 endpoint (not v1beta) and query parameter format (proven to work in nano-banana.ts)
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Gemini API error:", {
        status: res.status,
        statusText: res.statusText,
        response: text.substring(0, 500),
      });
      return NextResponse.json(
        { 
          error: "Gemini API error", 
          detail: text.substring(0, 500),
          status: res.status 
        },
        { status: 500 }
      );
    }

    const data = await res.json();
    const rawText =
      data.candidates?.[0]?.content?.parts?.[0]?.text ??
      data.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text)
        .join("\n");

    if (!rawText) {
      console.error("No response from Gemini:", JSON.stringify(data, null, 2));
      return NextResponse.json(
        { 
          error: "No response from Gemini", 
          detail: "The API returned an empty response. Check the API response structure." 
        },
        { status: 500 }
      );
    }

    // Strip code fences if present
    let jsonText = rawText
      .replace(/```json/gi, "")
      .replace(/```typescript/gi, "")
      .replace(/```/g, "")
      .trim();

    // Try to extract JSON if it's embedded in text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    let template: FlyerTemplate;
    try {
      template = JSON.parse(jsonText) as FlyerTemplate;
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Raw text (first 1000 chars):", jsonText.substring(0, 1000));
      return NextResponse.json(
        {
          error: "Failed to parse AI response as JSON",
          detail: jsonText.substring(0, 500),
        },
        { status: 500 }
      );
    }

    // Validate template structure
    if (!template.elements || !Array.isArray(template.elements)) {
      return NextResponse.json(
        { error: "Invalid template structure: missing elements array" },
        { status: 500 }
      );
    }

    return NextResponse.json({ template, listing });
  } catch (err: any) {
    console.error("AI flyer route error", err);
    return NextResponse.json(
      { error: "Server error", detail: err?.message },
      { status: 500 }
    );
  }
}

