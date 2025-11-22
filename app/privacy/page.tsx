import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - FLYR Pro",
  description: "Privacy Policy for FLYR Pro - Direct Mail Campaign Management",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12 md:py-16">
        <header className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Privacy Policy
          </h1>
          <p className="text-gray-600 text-lg">
            Last Updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </header>

        <div className="prose prose-lg max-w-none">
          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Introduction</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Welcome to FLYR Pro (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your privacy and ensuring you have a positive experience while using our application. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use FLYR Pro, a mobile and web application designed for real estate agents to track flyer drops, build farming campaigns, generate QR codes, and manage leads.
            </p>
            <p className="text-gray-700 leading-relaxed">
              By using FLYR Pro, you agree to the collection and use of information in accordance with this policy. If you do not agree with our policies and practices, please do not use our application.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Information We Collect</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We collect information that you provide directly to us and information that is automatically collected when you use FLYR Pro. The types of information we collect include:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li><strong>Account Information:</strong> Email address, name, and user ID when you create an account</li>
              <li><strong>Precise Location Data:</strong> Your device&apos;s precise location (GPS coordinates) when you use location-based features of the app</li>
              <li><strong>Product Interaction Data:</strong> Information about how you interact with FLYR Pro, including features you use, campaigns you create, QR codes you generate, and leads you manage</li>
              <li><strong>Crash Data:</strong> Technical information about app crashes and errors to help us improve the stability and performance of FLYR Pro</li>
              <li><strong>Contact & Lead Data:</strong> Information about contacts and leads you add to the app, including names, addresses, phone numbers, and other details you provide</li>
              <li><strong>Campaign Data:</strong> Information about your farming campaigns, flyer drops, and related activities</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">How We Use Your Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We use the information we collect for the following purposes:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li><strong>User Accounts:</strong> To create and manage your account, authenticate your identity, and provide access to FLYR Pro&apos;s features</li>
              <li><strong>App Functionality:</strong> To enable core features of the app, including campaign management, QR code generation, lead tracking, and location-based services</li>
              <li><strong>Analytics:</strong> To analyze how you use FLYR Pro, understand user preferences, and improve our services</li>
              <li><strong>Location Services:</strong> To display your location on maps, enable location-based features, and help you track flyer drops and farming activities</li>
              <li><strong>Customer Support:</strong> To respond to your inquiries, provide technical support, and address any issues you may encounter</li>
              <li><strong>App Improvement:</strong> To identify and fix bugs, improve app performance, and develop new features</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Location Data</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FLYR Pro collects precise location data from your device to provide location-based features, including:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li>Displaying your current location on interactive maps</li>
              <li>Tracking flyer drop locations for your campaigns</li>
              <li>Enabling location-based farming and territory management</li>
              <li>Providing location context for your leads and contacts</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              You can control location permissions through your device settings. If you disable location services, some features of FLYR Pro may not function properly. We only collect location data when you actively use location-based features of the app.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact & Lead Data</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              When you add contacts and leads to FLYR Pro, you are responsible for ensuring you have the necessary permissions to collect and store this information. We store this data securely to enable you to:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li>Manage your real estate contacts and leads</li>
              <li>Track interactions and follow-ups</li>
              <li>Associate contacts with your campaigns and QR codes</li>
              <li>Generate reports and analytics about your leads</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              You retain ownership of all contact and lead data you add to FLYR Pro. We do not use this data for any purpose other than providing the services you request.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">QR Codes & Campaign Data</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FLYR Pro allows you to generate QR codes and create farming campaigns. We store information about:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li>QR codes you generate, including associated URLs and metadata</li>
              <li>Campaign details, including target areas, flyer drop locations, and campaign parameters</li>
              <li>Analytics data related to QR code scans and campaign performance</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              This data is stored securely and is only accessible to you through your account. We use this information solely to provide campaign management and analytics features.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">How We Store and Protect Data</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We take data security seriously and implement appropriate technical and organizational measures to protect your information:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li>All data is stored securely using industry-standard encryption</li>
              <li>We use secure authentication methods to protect access to your account</li>
              <li>Data is stored on secure servers with restricted access</li>
              <li>We regularly review and update our security practices</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              However, no method of transmission over the internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your information, we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Sharing of Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We do not sell, rent, or trade your personal information to third parties. We do not share your information with third parties for advertising or marketing purposes. We do not engage in advertising tracking.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              We may share your information only in the following limited circumstances:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li><strong>Service Providers:</strong> We share data with Supabase, our cloud database and authentication service provider, which is necessary for FLYR Pro to function. Supabase is contractually obligated to protect your information and use it only for the purpose of providing services to us.</li>
              <li><strong>Legal Requirements:</strong> We may disclose your information if required by law, court order, or governmental regulation, or if we believe disclosure is necessary to protect our rights, your safety, or the safety of others.</li>
              <li><strong>Business Transfers:</strong> In the event of a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction, subject to the same privacy protections.</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Cookies</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FLYR Pro uses minimal cookies and similar tracking technologies. We use only essential cookies necessary for the app to function properly, such as authentication cookies. We do not use cookies for advertising, tracking, or analytics purposes beyond what is necessary for core app functionality.
            </p>
            <p className="text-gray-700 leading-relaxed">
              You can control cookies through your browser or device settings, though disabling essential cookies may affect the functionality of FLYR Pro.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Your Rights</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Depending on your location, you may have certain rights regarding your personal information, including:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li><strong>Access:</strong> You can access and review the personal information we hold about you through your account settings</li>
              <li><strong>Correction:</strong> You can update or correct your personal information at any time through your account settings</li>
              <li><strong>Deletion:</strong> You can request deletion of your account and associated data by contacting us</li>
              <li><strong>Data Portability:</strong> You can request a copy of your data in a portable format</li>
              <li><strong>Opt-Out:</strong> You can opt out of certain data collection by adjusting your device or app settings</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              To exercise these rights, please contact us using the information provided in the Contact Information section below.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Children&apos;s Privacy</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FLYR Pro is not intended for use by children under the age of 13 (or the applicable age of consent in your jurisdiction). We do not knowingly collect personal information from children under 13.
            </p>
            <p className="text-gray-700 leading-relaxed">
              If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information promptly.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Changes to This Policy</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of any material changes by:
            </p>
            <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-700">
              <li>Posting the updated Privacy Policy on this page</li>
              <li>Updating the &quot;Last Updated&quot; date at the top of this policy</li>
              <li>Providing notice through the app or via email for significant changes</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              Your continued use of FLYR Pro after any changes to this Privacy Policy constitutes your acceptance of the updated policy. We encourage you to review this Privacy Policy periodically.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact Information</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
              <p className="text-gray-700 mb-2">
                <strong>FLYR Pro</strong>
              </p>
              <p className="text-gray-700 mb-2">
                Email: <a href="mailto:privacy@flyrpro.app" className="text-blue-600 hover:text-blue-800 underline">privacy@flyrpro.app</a>
              </p>
              <p className="text-gray-700">
                Website: <a href="https://www.flyrpro.app" className="text-blue-600 hover:text-blue-800 underline">www.flyrpro.app</a>
              </p>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">Effective Date</h2>
            <p className="text-gray-700 leading-relaxed">
              This Privacy Policy is effective as of {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} and will remain in effect except with respect to any changes in its provisions in the future, which will take effect immediately upon being posted on this page.
            </p>
          </section>
        </div>

        <footer className="mt-16 pt-8 border-t border-gray-200">
          <p className="text-gray-600 text-center">
            © {new Date().getFullYear()} FLYR Pro. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}

