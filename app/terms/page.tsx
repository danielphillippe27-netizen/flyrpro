import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

const EFFECTIVE_DATE = "March 16, 2026";

const sectionTitleClass = "text-2xl font-bold tracking-tight text-zinc-950";
const paragraphClass = "text-zinc-700";
const listClass = "list-disc space-y-2 pl-5 text-zinc-700";
const linkClass = "font-medium text-red-600 underline underline-offset-4 hover:text-red-700";

export const metadata: Metadata = {
  title: "Terms of Service | FLYR",
  description:
    "Terms of Service for FLYR and FLYR Pro, including subscriptions, free trials, billing, acceptable use, and contact information.",
  alternates: {
    canonical: "/terms",
  },
  openGraph: {
    title: "Terms of Service | FLYR",
    description:
      "Read the Terms of Service for FLYR and FLYR Pro.",
    url: "https://www.flyrpro.app/terms",
    siteName: "FLYR",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsPage() {
  return (
    <LegalPageLayout
      currentPage="terms"
      title="Terms of Service"
      description="These Terms govern your access to and use of the FLYR websites, mobile applications, and related services."
      effectiveDate={EFFECTIVE_DATE}
    >
      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Effective Date</h2>
        <p className={paragraphClass}>
          These Terms of Service are effective as of {EFFECTIVE_DATE}.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Overview</h2>
        <p className={paragraphClass}>
          These Terms of Service (&quot;Terms&quot;) form a binding agreement between you and
          FLYR, doing business as FLYR and FLYR Pro (&quot;FLYR,&quot;
          &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;), regarding your use of our websites,
          software, mobile applications, and related services (collectively, the
          &quot;Services&quot;).
        </p>
        <p className={paragraphClass}>
          By accessing or using the Services, you agree to these Terms. If you do not
          agree, do not use the Services.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Eligibility and Accounts</h2>
        <p className={paragraphClass}>
          You must be legally able to enter into a binding contract to use the Services.
          If you use the Services on behalf of a company, team, or brokerage, you confirm
          that you have authority to bind that entity to these Terms.
        </p>
        <ul className={listClass}>
          <li>You must provide accurate account and billing information.</li>
          <li>
            You are responsible for maintaining the confidentiality of your login
            credentials and for all activity under your account.
          </li>
          <li>
            You must promptly notify us if you believe your account has been accessed
            without authorization.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Acceptable Use</h2>
        <p className={paragraphClass}>
          You may use the Services only in compliance with applicable law and these Terms.
        </p>
        <ul className={listClass}>
          <li>
            Reverse engineer, interfere with, or disrupt the security or integrity of the
            Services.
          </li>
          <li>
            Upload, transmit, or distribute content that is unlawful, fraudulent,
            infringing, harmful, or misleading.
          </li>
          <li>
            Use the Services to spam, harass, scrape, or send unauthorized marketing
            communications.
          </li>
          <li>
            Access the Services through unauthorized automated means or attempt to bypass
            rate limits, access controls, or subscription restrictions.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Subscription, Billing, and Auto-Renewal</h2>
        <p className={paragraphClass}>
          Some features require a paid subscription. Subscription pricing, plan features,
          and billing intervals are presented at the time of purchase and may change from
          time to time as described in these Terms.
        </p>
        <ul className={listClass}>
          <li>
            Paid subscriptions renew automatically at the end of each billing period unless
            canceled before renewal.
          </li>
          <li>
            If you subscribe through the Apple App Store, Apple handles billing using your
            Apple ID account, and Apple&apos;s payment, renewal, and cancellation terms also
            apply.
          </li>
          <li>
            If you subscribe through our website or another direct billing channel, you
            authorize us and our payment processors to charge the payment method on file for
            recurring fees, taxes, and any applicable overage or seat charges.
          </li>
          <li>
            You are responsible for keeping payment details current so your subscription can
            renew without interruption.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Free Trials</h2>
        <p className={paragraphClass}>
          We may offer free trials or promotional access to certain paid plans. Unless we
          clearly state otherwise at signup, a free trial converts to a paid subscription
          automatically when the trial ends unless you cancel before the end of the trial
          period.
        </p>
        <p className={paragraphClass}>
          Trial eligibility, duration, and included features may vary. We may modify or end
          a trial offer at any time to the extent permitted by law.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Cancellations and Refunds</h2>
        <p className={paragraphClass}>
          You may cancel a subscription at any time, but cancellation takes effect at the
          end of the current paid billing period unless otherwise required by law.
        </p>
        <ul className={listClass}>
          <li>
            App Store subscriptions must be managed through your Apple account settings.
          </li>
          <li>
            Refund requests for App Store purchases are handled by Apple under Apple&apos;s
            policies.
          </li>
          <li>
            For direct web purchases, fees are generally non-refundable except where
            required by law or where we expressly state otherwise in writing.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Intellectual Property</h2>
        <p className={paragraphClass}>
          The Services, including our software, designs, text, graphics, trademarks, logos,
          and other content, are owned by or licensed to FLYR and are protected by
          intellectual property laws. Subject to these Terms, we grant you a limited,
          non-exclusive, non-transferable, revocable right to use the Services for your
          internal business or personal use.
        </p>
        <p className={paragraphClass}>
          Except as expressly allowed by us in writing, you may not copy, modify,
          distribute, sell, sublicense, or create derivative works from the Services.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>User Content and Data</h2>
        <p className={paragraphClass}>
          You retain ownership of the content, campaign information, leads, contact records,
          files, and other data you submit to the Services (&quot;User Data&quot;). You grant
          us a limited license to host, process, transmit, and display User Data solely as
          needed to operate, secure, improve, and support the Services.
        </p>
        <ul className={listClass}>
          <li>
            You are responsible for the legality, accuracy, and rights needed to use User
            Data with the Services.
          </li>
          <li>
            You represent that your User Data does not violate law, contract, privacy
            rights, or intellectual property rights.
          </li>
          <li>
            We may remove or restrict User Data that violates these Terms or creates risk to
            the Services, users, or third parties.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Privacy</h2>
        <p className={paragraphClass}>
          Our{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>{" "}
          explains how we collect, use, and protect personal information. By using the
          Services, you acknowledge that we may process information in accordance with that
          policy.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Third-Party Services</h2>
        <p className={paragraphClass}>
          The Services may rely on or link to third-party products, infrastructure, payment
          processors, analytics tools, app stores, maps, and integrations. Your use of those
          third-party services may be governed by separate terms and privacy policies.
        </p>
        <p className={paragraphClass}>
          We are not responsible for third-party services, and we do not guarantee their
          availability, accuracy, security, or performance.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Disclaimers</h2>
        <p className={paragraphClass}>
          To the maximum extent permitted by law, the Services are provided &quot;as is&quot;
          and &quot;as available.&quot; We disclaim all warranties, whether express, implied,
          statutory, or otherwise, including implied warranties of merchantability, fitness
          for a particular purpose, title, non-infringement, and uninterrupted or error-free
          operation.
        </p>
        <p className={paragraphClass}>
          We do not guarantee that the Services will meet your requirements or that campaign
          outcomes, lead generation, routing efficiency, or business results will be
          successful or error-free.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Limitation of Liability</h2>
        <p className={paragraphClass}>
          To the fullest extent permitted by law, FLYR and its affiliates, licensors,
          service providers, and personnel will not be liable for any indirect, incidental,
          special, consequential, exemplary, or punitive damages, or for any loss of profits,
          revenues, data, goodwill, or business interruption arising out of or related to the
          Services or these Terms.
        </p>
        <p className={paragraphClass}>
          To the fullest extent permitted by law, our total liability for all claims relating
          to the Services or these Terms will not exceed the greater of: (a) the amount you
          paid to us for the Services during the 12 months before the claim arose, or (b)
          CAD $100.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Indemnification</h2>
        <p className={paragraphClass}>
          You agree to defend, indemnify, and hold harmless FLYR, its affiliates, and their
          respective officers, directors, employees, contractors, and agents from and against
          any claims, losses, liabilities, damages, judgments, costs, and expenses, including
          reasonable legal fees, arising out of or related to your User Data, your misuse of
          the Services, or your violation of these Terms or applicable law.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Termination</h2>
        <p className={paragraphClass}>
          You may stop using the Services at any time. We may suspend or terminate your
          access if we reasonably believe you violated these Terms, created risk for other
          users, failed to pay applicable fees, or if we need to do so for legal, security,
          or operational reasons.
        </p>
        <p className={paragraphClass}>
          Upon termination, your right to use the Services ends immediately. Sections that
          should reasonably survive termination, including billing obligations, intellectual
          property, disclaimers, limitations of liability, indemnification, and dispute-related
          provisions, will survive.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Changes to These Terms</h2>
        <p className={paragraphClass}>
          We may update these Terms from time to time. If we make material changes, we may
          provide notice through the Services, by email, or by posting an updated version on
          this page. The updated Terms become effective when posted unless a later date is
          stated.
        </p>
        <p className={paragraphClass}>
          Your continued use of the Services after the updated Terms take effect means you
          accept the revised Terms.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={sectionTitleClass}>Contact Information</h2>
        <p className={paragraphClass}>
          If you have questions about these Terms or need to send a legal notice, contact:
        </p>
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-5 text-zinc-700">
          <p className="font-semibold text-zinc-950">FLYR</p>
          <p>
            <a href="mailto:flyrpro@gmail.com" className={linkClass}>
              flyrpro@gmail.com
            </a>
          </p>
          <p>5900 Main St Orono ON L0B 1M0</p>
          <p>
            Privacy questions:{" "}
            <a href="mailto:privacy@flyrpro.app" className={linkClass}>
              privacy@flyrpro.app
            </a>
          </p>
        </div>
      </section>
    </LegalPageLayout>
  );
}
