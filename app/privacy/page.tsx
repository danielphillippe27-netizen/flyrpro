import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

const EFFECTIVE_DATE = "March 16, 2026";

const sectionTitleClass = "text-2xl font-bold tracking-tight text-zinc-950";
const paragraphClass = "text-zinc-700";
const listClass = "list-disc space-y-2 pl-5 text-zinc-700";
const linkClass = "font-medium text-red-600 underline underline-offset-4 hover:text-red-700";

export const metadata: Metadata = {
  title: "Privacy Policy | FLYR",
  description: "Privacy Policy for FLYR and FLYR Pro.",
  alternates: {
    canonical: "/privacy",
  },
  openGraph: {
    title: "Privacy Policy | FLYR",
    description: "Read the Privacy Policy for FLYR and FLYR Pro.",
    url: "https://www.flyrpro.app/privacy",
    siteName: "FLYR",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      currentPage="privacy"
      title="Privacy Policy"
      description="This Privacy Policy explains how FLYR Pro collects, uses, stores, and shares information when you use our services."
      effectiveDate={EFFECTIVE_DATE}
    >
      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Introduction</h2>
        <p className={paragraphClass}>
          Welcome to FLYR Pro (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are
          committed to protecting your privacy and ensuring you have a positive experience
          while using our application. This Privacy Policy explains how we collect, use,
          disclose, and safeguard your information when you use FLYR Pro, a mobile and web
          application designed for real estate agents to track flyer drops, build farming
          campaigns, generate QR codes, and manage leads.
        </p>
        <p className={paragraphClass}>
          By using FLYR Pro, you agree to the collection and use of information in
          accordance with this policy. If you do not agree with our policies and practices,
          please do not use our application.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Information We Collect</h2>
        <p className={paragraphClass}>
          We collect information that you provide directly to us and information that is
          automatically collected when you use FLYR Pro.
        </p>
        <ul className={listClass}>
          <li>
            <strong>Account Information:</strong> Email address, name, and user ID when you
            create an account.
          </li>
          <li>
            <strong>Precise Location Data:</strong> Your device&apos;s GPS location when you
            use location-based features.
          </li>
          <li>
            <strong>Product Interaction Data:</strong> Information about how you use FLYR
            Pro, including features, campaigns, QR codes, and leads.
          </li>
          <li>
            <strong>Crash Data:</strong> Technical diagnostics about app crashes and errors.
          </li>
          <li>
            <strong>Contact and Lead Data:</strong> Names, addresses, phone numbers, and
            related details you choose to add.
          </li>
          <li>
            <strong>Campaign Data:</strong> Information about your farming campaigns, flyer
            drops, and related activities.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>How We Use Your Information</h2>
        <p className={paragraphClass}>We use collected information to operate and improve the service.</p>
        <ul className={listClass}>
          <li>
            <strong>User Accounts:</strong> To create and manage accounts and authenticate
            your identity.
          </li>
          <li>
            <strong>App Functionality:</strong> To provide campaign management, QR code
            generation, lead tracking, and related product features.
          </li>
          <li>
            <strong>Analytics:</strong> To understand how the service is used and improve it.
          </li>
          <li>
            <strong>Location Services:</strong> To power mapping, route, and flyer-drop
            workflows.
          </li>
          <li>
            <strong>Customer Support:</strong> To respond to requests and troubleshoot issues.
          </li>
          <li>
            <strong>App Improvement:</strong> To fix bugs, improve performance, and develop
            new features.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Location Data</h2>
        <p className={paragraphClass}>
          FLYR Pro collects precise location data to provide location-based features,
          including:
        </p>
        <ul className={listClass}>
          <li>Displaying your current location on maps.</li>
          <li>Tracking flyer drop locations for campaigns.</li>
          <li>Enabling location-based farming and territory management.</li>
          <li>Providing location context for leads and contacts.</li>
        </ul>
        <p className={paragraphClass}>
          You can control location permissions through your device settings. If you disable
          location services, some features may not function properly. We collect location
          data only when you actively use location-based features.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Contact and Lead Data</h2>
        <p className={paragraphClass}>
          When you add contacts and leads to FLYR Pro, you are responsible for ensuring you
          have the permissions needed to collect and store that information.
        </p>
        <ul className={listClass}>
          <li>Manage contacts and leads.</li>
          <li>Track interactions and follow-ups.</li>
          <li>Associate contacts with campaigns and QR codes.</li>
          <li>Generate reports and analytics about your pipeline.</li>
        </ul>
        <p className={paragraphClass}>
          You retain ownership of contact and lead data you add to FLYR Pro. We do not use
          that data for any purpose other than providing the Services.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>QR Codes and Campaign Data</h2>
        <p className={paragraphClass}>
          FLYR Pro allows you to generate QR codes and create farming campaigns. We store:
        </p>
        <ul className={listClass}>
          <li>QR codes you generate, including associated URLs and metadata.</li>
          <li>Campaign details, including target areas and flyer-drop activity.</li>
          <li>Analytics data related to QR scans and campaign performance.</li>
        </ul>
        <p className={paragraphClass}>
          This data is stored securely and is accessible to you through your account. We use
          it to provide campaign management and analytics features.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>How We Store and Protect Data</h2>
        <p className={paragraphClass}>
          We take data security seriously and implement appropriate technical and
          organizational safeguards.
        </p>
        <ul className={listClass}>
          <li>Data is stored using industry-standard security controls.</li>
          <li>We use secure authentication methods to protect account access.</li>
          <li>Data is stored on secure servers with restricted access.</li>
          <li>We review and update security practices regularly.</li>
        </ul>
        <p className={paragraphClass}>
          No transmission or storage method is completely secure, so we cannot guarantee
          absolute security.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Sharing of Information</h2>
        <p className={paragraphClass}>
          We do not sell, rent, or trade your personal information. We do not share your
          information for third-party advertising and do not engage in advertising tracking.
        </p>
        <p className={paragraphClass}>We may share information only in limited circumstances:</p>
        <ul className={listClass}>
          <li>
            <strong>Service Providers:</strong> We use service providers such as Supabase to
            operate core product infrastructure.
          </li>
          <li>
            <strong>Legal Requirements:</strong> We may disclose information if required by
            law or if necessary to protect rights, safety, or the Services.
          </li>
          <li>
            <strong>Business Transfers:</strong> Information may transfer as part of a merger,
            acquisition, or sale of assets, subject to applicable privacy protections.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Cookies</h2>
        <p className={paragraphClass}>
          FLYR Pro uses minimal cookies and similar technologies. We use essential cookies
          needed for authentication and core service functionality. We do not use cookies
          for advertising purposes.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Your Rights</h2>
        <p className={paragraphClass}>
          Depending on your location, you may have rights regarding personal information,
          including:
        </p>
        <ul className={listClass}>
          <li>
            <strong>Access:</strong> You can access and review personal information we hold
            about you.
          </li>
          <li>
            <strong>Correction:</strong> You can update or correct personal information.
          </li>
          <li>
            <strong>Deletion:</strong> You can request deletion of your account and related
            data.
          </li>
          <li>
            <strong>Data Portability:</strong> You can request a copy of your data in a
            portable format.
          </li>
          <li>
            <strong>Opt-Out:</strong> You can limit certain data collection through device or
            app settings.
          </li>
        </ul>
        <p className={paragraphClass}>
          To exercise these rights, contact us using the information below.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Children&apos;s Privacy</h2>
        <p className={paragraphClass}>
          FLYR Pro is not intended for children under 13, or the applicable age of consent
          in your jurisdiction. We do not knowingly collect personal information from
          children under that age.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Changes to This Policy</h2>
        <p className={paragraphClass}>
          We may update this Privacy Policy from time to time to reflect changes in our
          practices, technology, legal requirements, or other factors. We will post the
          updated policy here and update the effective date above.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Contact Information</h2>
        <p className={paragraphClass}>
          If you have questions, concerns, or requests regarding this Privacy Policy or our
          data practices, contact us:
        </p>
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5 text-zinc-700">
          <p className="font-semibold text-zinc-950">FLYR Pro</p>
          <p>
            Email:{" "}
            <a href="mailto:privacy@flyrpro.app" className={linkClass}>
              privacy@flyrpro.app
            </a>
          </p>
          <p>
            Website:{" "}
            <a href="https://www.flyrpro.app" className={linkClass}>
              www.flyrpro.app
            </a>
          </p>
          <p>
            Related terms:{" "}
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>
          </p>
        </div>
      </section>
    </LegalPageLayout>
  );
}
