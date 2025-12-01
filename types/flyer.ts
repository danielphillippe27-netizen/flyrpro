/**
 * Flyer Template Type Definitions
 * 
 * Structured types for AI-generated flyer templates that are rendered with React.
 */

export type FlyerElement =
  | {
      type: "headline" | "subheadline" | "body" | "label";
      bind?: "status" | "address" | "price" | "bedsBaths" | "description";
      text?: string;
      x: number;
      y: number;
      width?: number;
      fontSize: number;
      fontWeight?: "normal" | "bold";
      color: string;
      align?: "left" | "center" | "right";
    }
  | {
      type: "image";
      bind: "propertyPhoto";
      x: number;
      y: number;
      width: number;
      height: number;
      borderRadius?: number;
    }
  | {
      type: "qr";
      bind: "qrUrl";
      x: number;
      y: number;
      size: number;
    }
  | {
      type: "shape";
      shape: "rect" | "ribbon";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      borderRadius?: number;
    };

export interface FlyerTemplate {
  id: string;
  name: string;
  size: "4x6" | "5x7" | "8.5x5.5";
  orientation: "horizontal" | "vertical";
  backgroundColor: string;
  brandColor: string;
  elements: FlyerElement[];
}

export interface FlyerListingData {
  campaignType: "Just Listed" | "Just Sold" | "Open House" | "Farming" | "Service Business";
  address: string;
  price: string;
  beds: number;
  baths: number;
  sqFt?: number;
  callToAction: string;
  photoUrl?: string;
  qrUrl: string;
  brandColor: string;
  style: "Clean & Minimal" | "Bold & Colorful" | "Luxury" | "Modern & Gradient";
  tone: "Professional" | "Friendly" | "High Energy" | "Luxury";
}

