import { NextRequest, NextResponse } from "next/server";

interface FreepikIcon {
  id: string;
  type: string;
  attributes: {
    name: string;
    description: string;
    tags: string[];
    downloads: number;
    premium: boolean;
    vector: boolean;
    files: {
      preview: {
        url: string;
      };
      download: {
        url: string;
      };
    };
  };
  links: {
    self: string;
  };
}

interface FreepikIconsResponse {
  data: FreepikIcon[];
  meta: {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("query") || "icon";
    const page = parseInt(searchParams.get("page") || "1");
    const perPage = parseInt(searchParams.get("per_page") || "30");

    const apiKey = process.env.FREEPIK || process.env.FREEPIK_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Freepik API key not configured",
          detail: "Please set FREEPIK or FREEPIK_API_KEY in your environment variables.",
        },
        { status: 500 }
      );
    }

    // Freepik Icons API endpoint
    const apiUrl = new URL("https://api.freepik.com/v1/resources");
    apiUrl.searchParams.set("query", query);
    apiUrl.searchParams.set("type", "icon");
    apiUrl.searchParams.set("page", page.toString());
    apiUrl.searchParams.set("per_page", perPage.toString());
    apiUrl.searchParams.set("locale", "en-US");

    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "X-Freepik-Api-Key": apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Freepik API error:", response.status, errorText);
      return NextResponse.json(
        {
          error: "Failed to fetch icons from Freepik",
          detail: `API returned status ${response.status}`,
        },
        { status: response.status }
      );
    }

    const data: FreepikIconsResponse = await response.json();

    // Transform the response to a simpler format
    const icons = data.data.map((icon) => ({
      id: icon.id,
      name: icon.attributes.name,
      description: icon.attributes.description,
      previewUrl: icon.attributes.files.preview.url,
      downloadUrl: icon.attributes.files.download.url,
      tags: icon.attributes.tags,
      premium: icon.attributes.premium,
      vector: icon.attributes.vector,
      downloads: icon.attributes.downloads,
      link: icon.links.self,
    }));

    return NextResponse.json({
      data: icons,
      meta: {
        total: data.meta.total,
        per_page: data.meta.per_page,
        current_page: data.meta.current_page,
        last_page: data.meta.last_page,
      },
    });
  } catch (error: any) {
    console.error("Error fetching Freepik icons:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch icons",
        detail: error?.message || "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}

