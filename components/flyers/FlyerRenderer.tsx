"use client";

import { useEffect, useState } from "react";
import { FlyerTemplate, FlyerListingData, FlyerElement } from "@/types/flyer";
import { generateQrDataUrl } from "@/lib/utils/qrCode";

interface Props {
  template: FlyerTemplate;
  listing: FlyerListingData;
  width?: number; // px
}

export function FlyerRenderer({ template, listing, width = 600 }: Props) {
  const height = template.orientation === "vertical" ? width * 1.5 : width * 0.7;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Generate QR code if needed
    const qrElement = template.elements.find(
      (el) => el.type === "qr"
    ) as Extract<FlyerElement, { type: "qr" }> | undefined;

    if (qrElement && listing.qrUrl) {
      generateQrDataUrl(listing.qrUrl, qrElement.size)
        .then(setQrDataUrl)
        .catch((err) => {
          console.error("Failed to generate QR code:", err);
        });
    }
  }, [template, listing.qrUrl]);

  const bindText = (bind?: string): string => {
    switch (bind) {
      case "status":
        return listing.campaignType.toUpperCase();
      case "address":
        return listing.address;
      case "price":
        return listing.price;
      case "bedsBaths":
        return `${listing.beds} Bed | ${listing.baths} Bath${
          listing.sqFt ? ` | ${listing.sqFt} SF` : ""
        }`;
      case "description":
        return listing.callToAction;
      default:
        return "";
    }
  };

  const bindImageUrl = (el: FlyerElement): string | undefined => {
    if (el.type === "image" && el.bind === "propertyPhoto") {
      return listing.photoUrl;
    }
    return undefined;
  };

  return (
    <div
      className="relative overflow-hidden shadow-xl rounded-2xl bg-white"
      style={{
        width,
        height,
        backgroundColor: template.backgroundColor,
      }}
    >
      {template.elements.map((el, idx) => {
        if (el.type === "shape") {
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                backgroundColor: el.color,
                borderRadius: el.borderRadius ?? 0,
              }}
            />
          );
        }

        if (el.type === "image") {
          const src = bindImageUrl(el);
          if (!src) return null;
          return (
            <img
              key={idx}
              src={src}
              alt={listing.address}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
                objectFit: "cover",
                borderRadius: el.borderRadius ?? 0,
              }}
            />
          );
        }

        if (el.type === "qr") {
          if (!qrDataUrl) return null;
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.size,
                height: el.size,
              }}
            >
              <img
                src={qrDataUrl}
                alt="QR Code"
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          );
        }

        // text elements
        const text = el.text ?? bindText(el.bind);
        return (
          <div
            key={idx}
            style={{
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.width,
              fontSize: el.fontSize,
              fontWeight: el.fontWeight ?? "normal",
              color: el.color,
              textAlign: el.align ?? "left",
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

