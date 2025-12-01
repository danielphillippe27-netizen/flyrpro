"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlyerListingData } from "@/types/flyer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CampaignType = "Just Listed" | "Just Sold" | "Open House" | "Farming" | "Service Business";
type Style = "Clean & Minimal" | "Bold & Colorful" | "Luxury" | "Modern & Gradient";
type Tone = "Professional" | "Friendly" | "High Energy" | "Luxury";

export default function CreateAIFlyerPage() {
  const router = useRouter();
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [size, setSize] = useState<"8.5x5.5" | "5x7">("5x7");
  const [finish, setFinish] = useState<"glossy" | "matte">("glossy");

  const [campaignType, setCampaignType] = useState<CampaignType>("Just Listed");
  const [address, setAddress] = useState("");
  const [price, setPrice] = useState("");
  const [beds, setBeds] = useState(3);
  const [baths, setBaths] = useState(2);
  const [sqFt, setSqFt] = useState<number | undefined>(2000);
  const [callToAction, setCallToAction] = useState("Scan to book a call");

  const [brandColor, setBrandColor] = useState("#111827");
  const [style, setStyle] = useState<Style>("Modern & Gradient");
  const [tone, setTone] = useState<Tone>("Professional");

  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [qrUrl, setQrUrl] = useState("https://example.com");
  const [includeQr, setIncludeQr] = useState(true);

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!callToAction.trim()) {
      setError("Please provide a call to action");
      return;
    }

    setIsGenerating(true);
    setError(null);

    const listing: FlyerListingData = {
      campaignType,
      address,
      price,
      beds,
      baths,
      sqFt,
      callToAction,
      photoUrl,
      qrUrl: includeQr ? qrUrl : "",
      brandColor,
      style,
      tone,
    };

    const config = { orientation, size, finish, includeQr };

    try {
      const res = await fetch("/api/ai/flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing, config }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to generate flyer");
        setIsGenerating(false);
        return;
      }

      const data = await res.json();
      // Store result in sessionStorage
      if (typeof window !== "undefined") {
        sessionStorage.setItem("flyr_ai_result", JSON.stringify(data));
      }

      router.push("/create/flyer/ai/result");
    } catch (err: any) {
      setError(err?.message ?? "Failed to generate flyer");
      setIsGenerating(false);
    }
  };

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className="mb-4 h-10 w-10 rounded-full border-4 border-gray-300 border-t-black animate-spin" />
        <h1 className="text-2xl font-semibold mb-2">Generating FLYR using AI…</h1>
        <p className="text-gray-500 text-center max-w-md">
          We're designing a custom flyer layout, placing your listing details, and preparing a
          print-ready design. This usually takes just a few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Create Flyer</h1>
          <p className="text-gray-500">
            Configure your flyer settings and let AI design a custom layout for your listing.
          </p>
        </div>

        {/* Configuration: Orientation / Size / Finish */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Configure your flyer settings</CardTitle>
            <CardDescription>Select orientation, size, and finish</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Orientation */}
            <div>
              <p className="text-sm text-gray-500 mb-2">Orientation</p>
              <div className="inline-flex rounded-full bg-gray-100 p-1">
                <button
                  className={`px-4 py-2 rounded-full text-sm ${
                    orientation === "horizontal"
                      ? "bg-black text-white"
                      : "text-gray-700"
                  }`}
                  onClick={() => setOrientation("horizontal")}
                >
                  Horizontal
                </button>
                <button
                  className={`px-4 py-2 rounded-full text-sm ${
                    orientation === "vertical" ? "bg-black text-white" : "text-gray-700"
                  }`}
                  onClick={() => setOrientation("vertical")}
                >
                  Vertical
                </button>
              </div>
            </div>

            {/* Size */}
            <div>
              <p className="text-sm text-gray-500 mb-2">Size</p>
              <div className="inline-flex rounded-full bg-gray-100 p-1">
                {(["8.5x5.5", "5x7"] as const).map((s) => (
                  <button
                    key={s}
                    className={`px-4 py-2 rounded-full text-sm ${
                      size === s ? "bg-black text-white" : "text-gray-700"
                    }`}
                    onClick={() => setSize(s)}
                  >
                    {s.replace("x", " × ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Finish */}
            <div>
              <p className="text-sm text-gray-500 mb-2">Finish</p>
              <div className="inline-flex rounded-full bg-gray-100 p-1">
                <button
                  className={`px-4 py-2 rounded-full text-sm ${
                    finish === "glossy" ? "bg-black text-white" : "text-gray-700"
                  }`}
                  onClick={() => setFinish("glossy")}
                >
                  Glossy
                </button>
                <button
                  className={`px-4 py-2 rounded-full text-sm ${
                    finish === "matte" ? "bg-black text-white" : "text-gray-700"
                  }`}
                  onClick={() => setFinish("matte")}
                >
                  Matte
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Campaign Details */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
            <CardDescription>Tell us about your campaign</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="campaign-type">Campaign Type</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(
                  [
                    "Just Listed",
                    "Just Sold",
                    "Open House",
                    "Farming",
                    "Service Business",
                  ] as CampaignType[]
                ).map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={campaignType === type ? "default" : "outline"}
                    onClick={() => setCampaignType(type)}
                    className="capitalize"
                  >
                    {type}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="address">Property Address</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St, City, State"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$500,000"
                className="mt-2"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="beds">Beds</Label>
                <Input
                  id="beds"
                  type="number"
                  value={beds}
                  onChange={(e) => setBeds(Number(e.target.value))}
                  placeholder="3"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="baths">Baths</Label>
                <Input
                  id="baths"
                  type="number"
                  value={baths}
                  onChange={(e) => setBaths(Number(e.target.value))}
                  placeholder="2"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="sqft">Sq Ft</Label>
                <Input
                  id="sqft"
                  type="number"
                  value={sqFt ?? ""}
                  onChange={(e) =>
                    setSqFt(e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder="2000"
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cta">Call to Action *</Label>
              <Select value={callToAction} onValueChange={setCallToAction}>
                <SelectTrigger id="cta" className="mt-2">
                  <SelectValue placeholder="Select a call to action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Scan to view full listing">
                    Scan to view full listing
                  </SelectItem>
                  <SelectItem value="Scan to get your home value">
                    Scan to get your home value
                  </SelectItem>
                  <SelectItem value="Scan to book a call">Scan to book a call</SelectItem>
                  <SelectItem value="Scan to visit my website">
                    Scan to visit my website
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Brand & Style */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Brand & Style</CardTitle>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="brand-color">Brand Color</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="brand-color"
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#111827"
                  className="flex-1"
                />
              </div>
            </div>

            <div>
              <Label>Style</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                {(
                  [
                    "Clean & Minimal",
                    "Bold & Colorful",
                    "Luxury",
                    "Modern & Gradient",
                  ] as Style[]
                ).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={style === s ? "default" : "outline"}
                    onClick={() => setStyle(s)}
                    className="h-auto py-3"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Tone</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(["Professional", "Friendly", "High Energy", "Luxury"] as Tone[]).map((t) => (
                  <Badge
                    key={t}
                    variant={tone === t ? "default" : "outline"}
                    className="cursor-pointer px-4 py-2 text-sm"
                    onClick={() => setTone(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Media & Assets + QR Options */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Media & QR</CardTitle>
            <CardDescription>Add property photos and configure QR code</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="photo-url">Property Photo URL (optional)</Label>
              <Input
                id="photo-url"
                value={photoUrl ?? ""}
                onChange={(e) => setPhotoUrl(e.target.value || undefined)}
                placeholder="https://example.com/photo.jpg"
                className="mt-2"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="qr-enabled"
                checked={includeQr}
                onChange={(e) => setIncludeQr(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="qr-enabled" className="cursor-pointer">
                Add QR code to flyer
              </Label>
            </div>
            {includeQr && (
              <div>
                <Label htmlFor="qr-url">QR Destination URL</Label>
                <Input
                  id="qr-url"
                  value={qrUrl}
                  onChange={(e) => setQrUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="mt-2"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <Card className="rounded-2xl shadow-sm border border-red-500">
            <CardContent className="pt-6">
              <p className="text-sm text-red-500">{error}</p>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-4">
          <Button
            onClick={handleGenerate}
            className="flex-1 bg-black text-white rounded-full py-3 font-semibold h-auto"
            size="lg"
          >
            Generate with AI
          </Button>
          <Button
            className="flex-1 border border-gray-300 rounded-full py-3 font-semibold h-auto"
            size="lg"
            variant="outline"
            disabled
          >
            Generate flyer image
          </Button>
        </div>
      </div>
    </div>
  );
}

