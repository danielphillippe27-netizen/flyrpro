import type { LandingPageData, CampaignLandingPage } from '@/types/database';

export class LandingPageGenerator {
  // Generate HTML for CampaignLandingPage (new schema)
  static generateCampaignLandingPage(landingPage: CampaignLandingPage): string {
    return this.generateMinimalBlackFromCampaign(landingPage);
  }

  // Generate HTML for LandingPageData (legacy schema)
  static generate(landingPage: LandingPageData): string {
    const template = landingPage.template_id || 'minimal_black';
    
    switch (template) {
      case 'minimal_black':
        return this.generateMinimalBlack(landingPage);
      case 'luxe_card':
        return this.generateLuxeCard(landingPage);
      case 'spotlight':
        return this.generateSpotlight(landingPage);
      default:
        return this.generateMinimalBlack(landingPage);
    }
  }

  // Generate minimal black template for CampaignLandingPage
  private static generateMinimalBlackFromCampaign(landingPage: CampaignLandingPage): string {
    const headline = landingPage.headline || 'Welcome';
    const subheadline = landingPage.subheadline || '';
    const ctaText = this.getCTAText(landingPage.cta_type);
    const ctaUrl = landingPage.cta_url || '#';
    const landingPageId = landingPage.id;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      text-align: center;
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; font-weight: 600; }
    h2 { font-size: 1.5rem; margin-bottom: 2rem; color: #999; font-weight: 400; }
    .cta {
      display: inline-block;
      background: #fff;
      color: #000;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1.1rem;
      transition: transform 0.2s;
      cursor: pointer;
    }
    .cta:hover { transform: scale(1.05); }
    img { max-width: 100%; border-radius: 8px; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    ${landingPage.hero_url ? `<img src="${landingPage.hero_url}" alt="${headline}" />` : ''}
    <h1>${headline}</h1>
    ${subheadline ? `<h2>${subheadline}</h2>` : ''}
    <a href="${ctaUrl}" class="cta" id="cta-button" data-landing-page-id="${landingPageId}">${ctaText}</a>
  </div>
  <script>
    // Track CTA click
    document.getElementById('cta-button').addEventListener('click', function(e) {
      const landingPageId = this.getAttribute('data-landing-page-id');
      if (landingPageId) {
        // Track click (non-blocking)
        fetch('/api/landing-page/cta-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ landingPageId: landingPageId })
        }).catch(err => console.error('Failed to track CTA click:', err));
      }
    });
  </script>
</body>
</html>
    `.trim();
  }

  // Helper to get CTA text based on cta_type
  private static getCTAText(ctaType?: string): string {
    switch (ctaType) {
      case 'book':
        return 'Book Now';
      case 'home_value':
        return 'Get Home Value';
      case 'contact':
        return 'Contact Us';
      case 'custom':
        return 'Learn More';
      default:
        return 'Get Started';
    }
  }

  private static generateMinimalBlack(landingPage: LandingPageData): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${landingPage.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #000;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      text-align: center;
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; font-weight: 600; }
    h2 { font-size: 1.5rem; margin-bottom: 2rem; color: #999; font-weight: 400; }
    p { font-size: 1.1rem; margin-bottom: 2rem; line-height: 1.6; color: #ccc; }
    .cta {
      display: inline-block;
      background: #fff;
      color: #000;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1.1rem;
      transition: transform 0.2s;
    }
    .cta:hover { transform: scale(1.05); }
    img { max-width: 100%; border-radius: 8px; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    ${landingPage.image_url ? `<img src="${landingPage.image_url}" alt="${landingPage.title}" />` : ''}
    <h1>${landingPage.title}</h1>
    <h2>${landingPage.subtitle}</h2>
    ${landingPage.description ? `<p>${landingPage.description}</p>` : ''}
    <a href="${landingPage.cta_url}" class="cta">${landingPage.cta_text}</a>
  </div>
</body>
</html>
    `.trim();
  }

  private static generateLuxeCard(landingPage: LandingPageData): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${landingPage.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 3rem;
      max-width: 600px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; color: #333; }
    h2 { font-size: 1.3rem; margin-bottom: 1.5rem; color: #666; font-weight: 400; }
    p { font-size: 1.1rem; margin-bottom: 2rem; line-height: 1.8; color: #555; }
    .cta {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1.1rem;
    }
    img { max-width: 100%; border-radius: 12px; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <div class="card">
    ${landingPage.image_url ? `<img src="${landingPage.image_url}" alt="${landingPage.title}" />` : ''}
    <h1>${landingPage.title}</h1>
    <h2>${landingPage.subtitle}</h2>
    ${landingPage.description ? `<p>${landingPage.description}</p>` : ''}
    <a href="${landingPage.cta_url}" class="cta">${landingPage.cta_text}</a>
  </div>
</body>
</html>
    `.trim();
  }

  private static generateSpotlight(landingPage: LandingPageData): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${landingPage.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 700px;
      text-align: center;
    }
    .spotlight {
      background: white;
      border-radius: 12px;
      padding: 3rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; color: #333; }
    h2 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #666; font-weight: 400; }
    p { font-size: 1.1rem; margin-bottom: 2rem; line-height: 1.8; color: #555; }
    .cta {
      display: inline-block;
      background: #007AFF;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1.1rem;
    }
    img { max-width: 100%; border-radius: 12px; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spotlight">
      ${landingPage.image_url ? `<img src="${landingPage.image_url}" alt="${landingPage.title}" />` : ''}
      <h1>${landingPage.title}</h1>
      <h2>${landingPage.subtitle}</h2>
      ${landingPage.description ? `<p>${landingPage.description}</p>` : ''}
      <a href="${landingPage.cta_url}" class="cta">${landingPage.cta_text}</a>
    </div>
  </div>
</body>
</html>
    `.trim();
  }
}

