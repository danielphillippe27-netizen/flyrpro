import type { FlyerTemplate } from './types/flyers';

/**
 * Flyer Templates
 * 
 * Pre-defined templates for creating real estate flyers.
 * Templates use a 1200x1600 vertical format optimized for print.
 */

export const flyerTemplates: FlyerTemplate[] = [
  {
    id: 'modern-open-house',
    name: 'Modern Open House',
    description: 'Clean, modern design perfect for open house events with prominent QR code',
    width: 1200,
    height: 1600,
    backgroundColor: '#ffffff',
    elements: [
      // Background accent rectangle
      {
        id: 'bg-accent',
        type: 'rect',
        x: 0,
        y: 0,
        width: 1200,
        height: 300,
        fill: '#0f766e', // teal-700
        cornerRadius: 0,
      },
      // Main headline
      {
        id: 'headline',
        type: 'text',
        x: 600,
        y: 150,
        text: 'OPEN HOUSE',
        fontSize: 72,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#ffffff',
        align: 'center',
        maxWidth: 1100,
      },
      // Subheadline
      {
        id: 'subheadline',
        type: 'text',
        x: 600,
        y: 250,
        text: 'Come see this beautiful property!',
        fontSize: 32,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#ffffff',
        align: 'center',
        maxWidth: 1100,
      },
      // Main photo placeholder
      {
        id: 'main-photo',
        type: 'image',
        x: 100,
        y: 400,
        width: 1000,
        height: 700,
        url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1000&h=700&fit=crop',
        objectFit: 'cover',
      },
      // Property details background
      {
        id: 'details-bg',
        type: 'rect',
        x: 100,
        y: 1150,
        width: 1000,
        height: 200,
        fill: '#f8fafc', // slate-50
        cornerRadius: 8,
      },
      // Property address
      {
        id: 'address',
        type: 'text',
        x: 150,
        y: 1200,
        text: '123 Main Street',
        fontSize: 28,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#1e293b', // slate-800
        align: 'left',
        maxWidth: 900,
      },
      // Property details
      {
        id: 'details',
        type: 'text',
        x: 150,
        y: 1250,
        text: '3 Bedrooms • 2 Bathrooms • 1,800 sq ft',
        fontSize: 20,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'left',
        maxWidth: 900,
      },
      // Date/time
      {
        id: 'date-time',
        type: 'text',
        x: 150,
        y: 1300,
        text: 'Saturday, January 15th • 2:00 PM - 4:00 PM',
        fontSize: 20,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#0f766e', // teal-700
        align: 'left',
        maxWidth: 900,
      },
      // Agent info background
      {
        id: 'agent-bg',
        type: 'rect',
        x: 100,
        y: 1400,
        width: 500,
        height: 150,
        fill: '#ffffff',
        cornerRadius: 8,
      },
      // Agent name
      {
        id: 'agent-name',
        type: 'text',
        x: 150,
        y: 1430,
        text: 'Jane Smith',
        fontSize: 24,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#1e293b', // slate-800
        align: 'left',
        maxWidth: 400,
      },
      // Agent contact
      {
        id: 'agent-contact',
        type: 'text',
        x: 150,
        y: 1470,
        text: '(555) 123-4567 • jane@realestate.com',
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'left',
        maxWidth: 400,
      },
      // QR code
      {
        id: 'qr-code',
        type: 'qrcode',
        x: 700,
        y: 1425,
        url: 'https://flyr.pro/property/123',
        size: 120,
      },
      // QR code label
      {
        id: 'qr-label',
        type: 'text',
        x: 760,
        y: 1550,
        text: 'Scan for more info',
        fontSize: 16,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'center',
        maxWidth: 200,
      },
    ],
  },
  {
    id: 'minimal-listing',
    name: 'Minimal Listing',
    description: 'Simple, elegant design focused on property details',
    width: 1200,
    height: 1600,
    backgroundColor: '#ffffff',
    elements: [
      // Top border accent
      {
        id: 'top-border',
        type: 'rect',
        x: 0,
        y: 0,
        width: 1200,
        height: 20,
        fill: '#059669', // emerald-600
        cornerRadius: 0,
      },
      // Property photo
      {
        id: 'property-photo',
        type: 'image',
        x: 100,
        y: 50,
        width: 1000,
        height: 800,
        url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1000&h=800&fit=crop',
        objectFit: 'cover',
      },
      // Property title
      {
        id: 'property-title',
        type: 'text',
        x: 600,
        y: 900,
        text: 'Stunning Modern Home',
        fontSize: 48,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#1e293b', // slate-800
        align: 'center',
        maxWidth: 1100,
      },
      // Price
      {
        id: 'price',
        type: 'text',
        x: 600,
        y: 980,
        text: '$549,000',
        fontSize: 42,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#059669', // emerald-600
        align: 'center',
        maxWidth: 1100,
      },
      // Features list
      {
        id: 'features',
        type: 'text',
        x: 600,
        y: 1060,
        text: '4 Bedrooms • 3 Bathrooms • 2,400 sq ft • 2-Car Garage',
        fontSize: 22,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#475569', // slate-600
        align: 'center',
        maxWidth: 1100,
      },
      // Address
      {
        id: 'address',
        type: 'text',
        x: 600,
        y: 1120,
        text: '456 Oak Avenue, City, State 12345',
        fontSize: 20,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'center',
        maxWidth: 1100,
      },
      // Agent section
      {
        id: 'agent-section',
        type: 'rect',
        x: 100,
        y: 1200,
        width: 1000,
        height: 300,
        fill: '#f1f5f9', // slate-100
        cornerRadius: 12,
      },
      // Agent name
      {
        id: 'agent-name',
        type: 'text',
        x: 150,
        y: 1250,
        text: 'John Doe',
        fontSize: 28,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        fill: '#1e293b', // slate-800
        align: 'left',
        maxWidth: 500,
      },
      // Agent title
      {
        id: 'agent-title',
        type: 'text',
        x: 150,
        y: 1290,
        text: 'Licensed Real Estate Agent',
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'left',
        maxWidth: 500,
      },
      // Agent phone
      {
        id: 'agent-phone',
        type: 'text',
        x: 150,
        y: 1330,
        text: 'Phone: (555) 987-6543',
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#1e293b', // slate-800
        align: 'left',
        maxWidth: 500,
      },
      // Agent email
      {
        id: 'agent-email',
        type: 'text',
        x: 150,
        y: 1370,
        text: 'Email: john@realestate.com',
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#1e293b', // slate-800
        align: 'left',
        maxWidth: 500,
      },
      // QR code
      {
        id: 'qr-code',
        type: 'qrcode',
        x: 850,
        y: 1280,
        url: 'https://flyr.pro/listing/456',
        size: 150,
      },
      // QR label
      {
        id: 'qr-label',
        type: 'text',
        x: 925,
        y: 1440,
        text: 'Scan for virtual tour',
        fontSize: 16,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fill: '#64748b', // slate-500
        align: 'center',
        maxWidth: 200,
      },
    ],
  },
];

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): FlyerTemplate | undefined {
  return flyerTemplates.find((template) => template.id === id);
}



