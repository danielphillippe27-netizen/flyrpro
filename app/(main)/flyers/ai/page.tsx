'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { NanoBananaDesign } from '@/lib/nano-banana';

type CampaignType = 'just-listed' | 'just-sold' | 'open-house' | 'farming' | 'service-business';
type Style = 'clean-minimal' | 'bold-colorful' | 'luxury' | 'modern-gradient';
type Tone = 'professional' | 'friendly' | 'high-energy' | 'luxury';
type QRDestinationType = 'listing-page' | 'lead-capture' | 'custom-url';

type GenerateResponse = {
  designs: NanoBananaDesign[];
};

function AIFlyerContent() {
  const searchParams = useSearchParams();
  const orientation = searchParams.get('orientation') || 'vertical';
  const size = searchParams.get('size') || '8.5x5.5';
  const finish = searchParams.get('finish') || 'glossy';

  // Form state
  const [campaignType, setCampaignType] = useState<CampaignType | ''>('');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [price, setPrice] = useState('');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [sqft, setSqft] = useState('');
  const [cta, setCta] = useState('');
  const [brandColor, setBrandColor] = useState('#111827');
  const [style, setStyle] = useState<Style | ''>('');
  const [tone, setTone] = useState<Tone | ''>('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [qrEnabled, setQrEnabled] = useState(true);
  const [qrDestinationType, setQrDestinationType] = useState<QRDestinationType>('listing-page');
  const [qrUrl, setQrUrl] = useState('');

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [designs, setDesigns] = useState<NanoBananaDesign[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Image generation state
  const [flyerImageUrl, setFlyerImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPhotos(Array.from(e.target.files));
    }
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    // Validation
    if (!campaignType || !cta) {
      setError('Please fill in all required fields (Campaign Type and Call to Action)');
      return;
    }

    if (!style || !tone) {
      setError('Please select a style and tone');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setDesigns([]);
    setSelectedDesignId(null);

    try {
      // Build payload matching NanoBananaRequest
      const payload = {
        orientation: orientation as 'horizontal' | 'vertical',
        size,
        finish: finish as 'glossy' | 'matte',
        campaignType,
        propertyAddress: propertyAddress || undefined,
        price: price || undefined,
        beds: beds ? Number(beds) : null,
        baths: baths ? Number(baths) : null,
        sqft: sqft ? Number(sqft) : null,
        cta,
        brandColor,
        style,
        tone,
        mediaUrls: [], // For now; later we can upload images and pass URLs
      };

      const response = await fetch('/api/ai-flyer/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to generate flyer (${response.status})`
        );
      }

      const data: GenerateResponse = await response.json();
      setDesigns(data.designs ?? []);
    } catch (err: any) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to generate flyer. Please try again.';
      setError(errorMessage);
      console.error('Generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSelectDesign = (designId: string) => {
    setSelectedDesignId(designId);
    // TODO: Load design into FLYR editor
    // For now, just log; later we'll navigate to the editor
    console.log('Selected design', designId);
  };

  // Build prompt for image generation from form data
  const buildFlyerPromptFromForm = (): string => {
    const normalizedStyle = style === 'bold-colorful' ? 'bold-color' : style;
    
    let prompt = `Create a professional real estate marketing flyer.

Campaign Details:
- Type: ${campaignType.replace(/-/g, ' ')}
- Style: ${normalizedStyle.replace(/-/g, ' ')}
- Tone: ${tone.replace(/-/g, ' ')}
- Brand Color: ${brandColor}
- Call to Action: ${cta}`;

    if (propertyAddress) prompt += `\n- Property Address: ${propertyAddress}`;
    if (price) prompt += `\n- Price: ${price}`;
    if (beds) prompt += `\n- Bedrooms: ${beds}`;
    if (baths) prompt += `\n- Bathrooms: ${baths}`;
    if (sqft) prompt += `\n- Square Feet: ${sqft}`;

    prompt += `\n\nDesign Requirements:
- Orientation: ${orientation}
- Size: ${size} inches
- Finish: ${finish}
- Include space for headline, property details, and QR code
- Use brand color ${brandColor} prominently
- Professional, modern real estate marketing style`;

    return prompt;
  };

  async function handleGenerateFlyerImage() {
    // Validation
    if (!campaignType || !cta) {
      setImageError('Please fill in all required fields (Campaign Type and Call to Action)');
      return;
    }

    if (!style || !tone) {
      setImageError('Please select a style and tone');
      return;
    }

    try {
      setIsGeneratingImage(true);
      setImageError(null);
      setFlyerImageUrl(null);

      // Build prompt from form data
      const prompt = buildFlyerPromptFromForm();

      // Determine aspect ratio based on orientation
      const aspectRatio = orientation === 'vertical' ? '3:4' : '4:3';

      const res = await fetch('/api/ai-flyer/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          size: '1K',
          aspectRatio,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Image API error: ${res.status}`);
      }

      const data = await res.json();
      setFlyerImageUrl(data.imageUrl);
    } catch (err: any) {
      console.error('AI flyer image error:', err);
      setImageError(err?.message ?? 'Failed to generate flyer image');
    } finally {
      setIsGeneratingImage(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Flyer Generator</h1>
          <p className="text-sm text-muted-foreground">Generate a flyer using AI</p>
        </div>

        {/* Configuration Summary */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Your selected flyer settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Orientation:</span>
                <p className="font-medium capitalize">{orientation}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>
                <p className="font-medium">{size}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Finish:</span>
                <p className="font-medium capitalize">{finish}</p>
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
              <Label htmlFor="campaign-type">Campaign Type *</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(['just-listed', 'just-sold', 'open-house', 'farming', 'service-business'] as CampaignType[]).map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={campaignType === type ? 'default' : 'outline'}
                    onClick={() => setCampaignType(type)}
                    className="capitalize"
                  >
                    {type.replace('-', ' ')}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="address">Property Address</Label>
              <Input
                id="address"
                value={propertyAddress}
                onChange={(e) => setPropertyAddress(e.target.value)}
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
                  onChange={(e) => setBeds(e.target.value)}
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
                  onChange={(e) => setBaths(e.target.value)}
                  placeholder="2"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="sqft">Sq Ft</Label>
                <Input
                  id="sqft"
                  type="number"
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  placeholder="2000"
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="cta">Call to Action *</Label>
              <Select value={cta} onValueChange={setCta}>
                <SelectTrigger id="cta" className="mt-2">
                  <SelectValue placeholder="Select a call to action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scan-to-view-listing">Scan to view full listing</SelectItem>
                  <SelectItem value="scan-to-get-value">Scan to get your home value</SelectItem>
                  <SelectItem value="scan-to-book-call">Scan to book a call</SelectItem>
                  <SelectItem value="scan-to-visit-website">Scan to visit my website</SelectItem>
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
                {(['clean-minimal', 'bold-colorful', 'luxury', 'modern-gradient'] as Style[]).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={style === s ? 'default' : 'outline'}
                    onClick={() => setStyle(s)}
                    className="capitalize h-auto py-3"
                  >
                    {s.replace('-', ' & ')}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Tone</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {(['professional', 'friendly', 'high-energy', 'luxury'] as Tone[]).map((t) => (
                  <Badge
                    key={t}
                    variant={tone === t ? 'default' : 'outline'}
                    className="cursor-pointer px-4 py-2 text-sm capitalize"
                    onClick={() => setTone(t)}
                  >
                    {t.replace('-', ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Media & Assets */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Media & Assets</CardTitle>
            <CardDescription>Upload property photos</CardDescription>
          </CardHeader>
          <CardContent>
            <div>
              <Label htmlFor="photos">Upload property photos (optional)</Label>
              <Input
                id="photos"
                type="file"
                multiple
                accept="image/*"
                onChange={handlePhotoChange}
                className="mt-2"
              />
              {photos.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {photos.length} photo{photos.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* QR Code & Options */}
        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>QR Code & Options</CardTitle>
            <CardDescription>Configure QR code settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="qr-enabled"
                checked={qrEnabled}
                onChange={(e) => setQrEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="qr-enabled" className="cursor-pointer">
                Add QR code to flyer
              </Label>
            </div>
            {qrEnabled && (
              <>
                <p className="text-sm text-muted-foreground">
                  We'll automatically place the QR code in a clean spot on the design.
                </p>
                <div>
                  <Label htmlFor="qr-destination">QR destination type</Label>
                  <Select
                    value={qrDestinationType}
                    onValueChange={(value) => setQrDestinationType(value as QRDestinationType)}
                  >
                    <SelectTrigger id="qr-destination" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="listing-page">Listing page</SelectItem>
                      <SelectItem value="lead-capture">Lead capture form</SelectItem>
                      <SelectItem value="custom-url">Custom URL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="qr-url">Destination URL</Label>
                  <Input
                    id="qr-url"
                    value={qrUrl}
                    onChange={(e) => setQrUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="mt-2"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Generate Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || isGeneratingImage}
            className="w-full h-12 text-base"
            size="lg"
            variant="default"
          >
            {isGenerating ? 'Generating...' : 'Generate with AI'}
          </Button>
          <Button
            onClick={handleGenerateFlyerImage}
            disabled={isGenerating || isGeneratingImage}
            className="w-full h-12 text-base"
            size="lg"
            variant="outline"
          >
            {isGeneratingImage ? 'Generating image...' : 'Generate flyer image'}
          </Button>
        </div>

        {/* Error Display */}
        {(error || imageError) && (
          <Card className="rounded-2xl shadow-sm border border-destructive">
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">{error || imageError}</p>
            </CardContent>
          </Card>
        )}

        {/* Image Generation Preview */}
        {flyerImageUrl && !isGeneratingImage && (
          <Card className="rounded-2xl shadow-sm border">
            <CardHeader>
              <CardTitle>Generated Flyer Image</CardTitle>
              <CardDescription>AI-generated flyer preview</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <img
                  src={flyerImageUrl}
                  alt="AI generated flyer"
                  className="max-w-full h-auto rounded-xl shadow-lg mx-auto"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      // TODO: Load image into FLYR editor
                      console.log('Loading image into editor:', flyerImageUrl);
                    }}
                    className="flex-1"
                  >
                    Use this image
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setFlyerImageUrl(null)}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Image Generation Loading */}
        {isGeneratingImage && (
          <Card className="rounded-2xl shadow-sm border">
            <CardHeader>
              <CardTitle>Generating flyer image…</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-8">
                <Skeleton className="h-[400px] w-full max-w-md rounded-md" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {isGenerating && (
          <Card className="rounded-2xl shadow-sm border">
            <CardHeader>
              <CardTitle>Generating your flyer…</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-[400px] w-full rounded-md" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {designs.length > 0 && !isGenerating && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">AI Results</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {designs.map((design) => (
                <Card
                  key={design.id}
                  className={cn(
                    'cursor-pointer transition rounded-2xl shadow-sm border',
                    selectedDesignId === design.id && 'ring-2 ring-black border-black'
                  )}
                  onClick={() => setSelectedDesignId(design.id)}
                >
                  <CardContent className="p-3 space-y-3">
                    <div className="aspect-[3/4] overflow-hidden rounded-md bg-muted">
                      <img
                        src={design.imageUrl}
                        alt={design.description ?? 'AI Flyer'}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    {design.description && (
                      <p className="text-xs text-muted-foreground">
                        {design.description}
                      </p>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectDesign(design.id);
                      }}
                    >
                      Use this design
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground text-center mt-4">
              Next step: load this into the FLYR editor (to be implemented).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIFlyerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <AIFlyerContent />
    </Suspense>
  );
}
