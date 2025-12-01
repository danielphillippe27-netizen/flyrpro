"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlyerTemplate, FlyerListingData } from "@/types/flyer";
import { FlyerRenderer } from "@/components/flyers/FlyerRenderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export default function AIFlyerResultPage() {
  const router = useRouter();
  const [template, setTemplate] = useState<FlyerTemplate | null>(null);
  const [listing, setListing] = useState<FlyerListingData | null>(null);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [isRevising, setIsRevising] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw =
      typeof window !== "undefined" ? sessionStorage.getItem("flyr_ai_result") : null;
    if (!raw) {
      router.replace("/create/flyer");
      return;
    }
    try {
      const data = JSON.parse(raw);
      setTemplate(data.template);
      setListing(data.listing);
    } catch (err) {
      console.error("Failed to parse stored result:", err);
      router.replace("/create/flyer");
    }
  }, [router]);

  if (!template || !listing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const handleRevise = async () => {
    if (!revisionPrompt.trim()) return;
    setIsRevising(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing,
          config: { orientation: template.orientation, size: template.size },
          previousTemplate: template,
          revisionPrompt,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to revise flyer");
        setIsRevising(false);
        return;
      }

      const data = await res.json();
      setTemplate(data.template);
      setRevisionPrompt("");
      if (typeof window !== "undefined") {
        sessionStorage.setItem("flyr_ai_result", JSON.stringify(data));
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to revise flyer");
    } finally {
      setIsRevising(false);
    }
  };

  const handleSave = async () => {
    if (!template || !listing) return;
    
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/ai/flyer/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template,
          listing,
          name: template.name || "AI Generated Flyer",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save flyer");
        setIsSaving(false);
        return;
      }

      const data = await res.json();
      setSaveSuccess(true);
      // Optionally navigate to the flyer editor
      if (data.flyerId && data.campaignId) {
        setTimeout(() => {
          router.push(`/campaigns/${data.campaignId}/flyers/${data.flyerId}/edit`);
        }, 1500);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to save flyer");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    // Simple: open browser print; advanced: call backend to generate print-ready PDF.
    window.print();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold">Your AI Flyer</h1>
          <p className="text-gray-500">
            Review your flyer, tweak it with AI, then save or print when you're ready.
          </p>
        </div>

        <div className="flex flex-col items-center">
          <FlyerRenderer template={template} listing={listing} width={500} />
        </div>

        <Card className="rounded-2xl shadow-sm border">
          <CardHeader>
            <CardTitle>Revise with AI</CardTitle>
            <CardDescription>
              Tell AI how to adjust the design. Example: "Make the price larger, move the QR code
              to the bottom right, and switch the accent color to red."
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="revision-prompt">Revision Instructions</Label>
              <Textarea
                id="revision-prompt"
                className="w-full min-h-[120px] rounded-xl border border-gray-300 p-3 text-sm mt-2"
                placeholder="Describe how you want to change this flyer…"
                value={revisionPrompt}
                onChange={(e) => setRevisionPrompt(e.target.value)}
              />
            </div>

            {error && (
              <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>
            )}
            {saveSuccess && (
              <div className="text-sm text-green-600 bg-green-50 p-3 rounded-lg">
                Flyer saved successfully! Redirecting to editor...
              </div>
            )}

            <div className="flex gap-4">
              <Button
                onClick={handleRevise}
                disabled={isRevising || !revisionPrompt.trim()}
                className="flex-1 bg-black text-white rounded-full py-3 font-semibold disabled:opacity-60"
              >
                {isRevising ? "Revising…" : "Revise with AI"}
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || saveSuccess}
                className="px-6 py-3 rounded-full border border-gray-300 font-semibold disabled:opacity-60"
                variant="outline"
              >
                {isSaving ? "Saving…" : saveSuccess ? "Saved!" : "Save flyer"}
              </Button>
              <Button
                onClick={handlePrint}
                className="px-6 py-3 rounded-full border border-gray-300 font-semibold"
                variant="outline"
              >
                Print
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

