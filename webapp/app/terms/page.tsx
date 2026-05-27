import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service - Record Platform',
  description: 'Terms of Service for Record Platform',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white shadow-lg rounded-lg p-8 sm:p-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>

        <p className="text-sm text-gray-500 mb-10">
          <strong>Last updated:</strong>{' '}
          {new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>

        <div className="space-y-10 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
            <p className="text-gray-700">
              By accessing and using Record Platform (&ldquo;the Service&rdquo;), you accept and
              agree to be bound by the terms and provision of this agreement. Record Platform
              provides record collecting, catalog intelligence, marketplace listing, pricing
              research, and observability tooling. If you do not agree to abide by these terms,
              please do not use this service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Use License</h2>
            <p className="text-gray-700 mb-4">
              Permission is granted to temporarily use Record Platform for personal, non-commercial
              transitory viewing only. This is the grant of a license, not a transfer of title, and
              under this license you may not:
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
              <li>Modify or copy the materials</li>
              <li>Use the materials for any commercial purpose or for any public display</li>
              <li>Attempt to reverse engineer any software contained in Record Platform</li>
              <li>Remove any copyright or other proprietary notations from the materials</li>
              <li>Transfer the materials to another person or &ldquo;mirror&rdquo; the materials on any other server</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">3. User Accounts</h2>
            <p className="text-gray-700 mb-4">
              To access certain features of the Service, you must register for an account. You agree
              to:
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and update your information to keep it accurate, current, and complete</li>
              <li>Maintain the security of your password and identification</li>
              <li>Accept all responsibility for activities that occur under your account</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">4. User Content</h2>
            <p className="text-gray-700 mb-4">
              You retain ownership of any content you submit, post, or display on or through the
              Service (&ldquo;User Content&rdquo;), including record listings, collection data, and
              catalog entries. By submitting User Content, you grant us a worldwide, non-exclusive,
              royalty-free license to use, reproduce, modify, and distribute your User Content solely
              for the purpose of operating and providing the Service.
            </p>
            <p className="text-gray-700 mb-4">
              You are solely responsible for your User Content and agree not to submit content that:
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
              <li>Violates any law or regulation</li>
              <li>Infringes on the rights of others</li>
              <li>Is defamatory, harassing, or offensive</li>
              <li>Contains viruses or other harmful code</li>
              <li>Is spam or unsolicited commercial content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Prohibited Uses</h2>
            <p className="text-gray-700 mb-4">
              You may not use the Service:
            </p>
            <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
              <li>In any way that violates any applicable law or regulation</li>
              <li>To transmit any malicious code or harmful software</li>
              <li>To impersonate or attempt to impersonate another user or entity</li>
              <li>To engage in any automated use of the system, such as scraping or data mining</li>
              <li>To interfere with or disrupt the Service or servers connected to the Service</li>
              <li>To attempt to gain unauthorized access to any portion of the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Intellectual Property</h2>
            <p className="text-gray-700">
              The Service and its original content, features, and functionality are owned by Record
              Platform and are protected by international copyright, trademark, patent, trade secret,
              and other intellectual property laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Disclaimer</h2>
            <p className="text-gray-700">
              The materials on Record Platform are provided on an &ldquo;as is&rdquo; basis. Record
              Platform makes no warranties, expressed or implied, and hereby disclaims and negates
              all other warranties including, without limitation, implied warranties or conditions of
              merchantability, fitness for a particular purpose, or non-infringement of intellectual
              property or other violation of rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Limitations</h2>
            <p className="text-gray-700">
              In no event shall Record Platform or its suppliers be liable for any damages
              (including, without limitation, damages for loss of data or profit, or due to business
              interruption) arising out of the use or inability to use the materials on Record
              Platform, even if Record Platform or a Record Platform authorized representative has
              been notified orally or in writing of the possibility of such damage.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Termination</h2>
            <p className="text-gray-700">
              We may terminate or suspend your account and access to the Service immediately,
              without prior notice or liability, for any reason whatsoever, including without
              limitation if you breach the Terms. Upon termination, your right to use the Service
              will immediately cease.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Changes to Terms</h2>
            <p className="text-gray-700">
              We reserve the right, at our sole discretion, to modify or replace these Terms at any
              time. If a revision is material, we will provide at least 30 days notice prior to any
              new terms taking effect. What constitutes a material change will be determined at our
              sole discretion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">11. Contact Information</h2>
            <p className="text-gray-700 mb-4">
              If you have any questions about these Terms of Service, please contact us:
            </p>
            <ul className="list-none text-gray-700 space-y-2 ml-4">
              <li><strong>Email:</strong> support@record-platform.local</li>
              <li><strong>Platform:</strong> Record Platform</li>
            </ul>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
