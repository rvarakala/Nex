/**
 * Legal pages — Terms / Privacy / Refund / Contact.
 *
 * Public, no-auth, mobile-friendly pages required for Razorpay
 * (and Stripe / PayU / any payment processor) website verification.
 * Routed via `/terms`, `/privacy`, `/refund`, `/contact`.
 */
import React from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';

const COMPANY = 'AUDINEXA';
const COMPANY_FULL = 'Audinexa Technologies (audinexa.com)';
const SUPPORT_EMAIL = 'support@audinexa.com';
const SALES_EMAIL = 'hello@audinexa.com';
const PHONE = '+91 90000 00000';
const ADDRESS = 'Mumbai, Maharashtra, India';

const PAGES = {
  terms: {
    title: 'Terms of Service',
    updated: '27 April 2026',
    sections: [
      ['1. Acceptance', `By signing up, accessing, or using ${COMPANY} (the "Service"), you agree to be bound by these Terms. If you do not agree, do not use the Service.`],
      ['2. The Service', `${COMPANY} is a Software-as-a-Service platform for audiology clinics in India. It provides clinic-management, patient records, hearing-aid (HA) sales / repair workflows, billing with GST-compliant invoicing, and analytics.`],
      ['3. Subscription & Payments', `${COMPANY} offers tiered subscriptions (Free trial / Standard / Premium). Recurring charges are processed through Razorpay or other authorised payment gateways. By subscribing, you authorise us to charge the applicable fees on a monthly or annual basis as selected at checkout. Patients of subscribing clinics may also pay invoices to those clinics through the Service; such payments are remitted to the respective clinic less applicable gateway fees.`],
      ['4. Acceptable Use', `You will not (a) use the Service for any unlawful purpose, (b) upload patient data without proper consent under DPDP Act 2023 / HIPAA-equivalent norms, (c) reverse engineer the platform, or (d) resell access without written permission.`],
      ['5. Data Protection', `Patient health data is encrypted in transit and at rest. Optional client-controlled encryption (BYOK Vault Mode) is available on Premium tiers. Refer to our Privacy Policy for details.`],
      ['6. Intellectual Property', `All Service content, trademarks, and software remain the exclusive property of ${COMPANY_FULL}. Limited, non-transferable license is granted for the duration of an active subscription.`],
      ['7. Termination', `Either party may terminate the agreement on 30 days written notice. Upon termination you may export your clinic data for 60 days, after which it will be deleted from active and backup storage.`],
      ['8. Limitation of Liability', `${COMPANY} is provided "as is". To the maximum extent permitted under applicable law, our aggregate liability is limited to the fees paid in the 12 months preceding the claim.`],
      ['9. Governing Law', `These Terms are governed by the laws of India. Any dispute is subject to the exclusive jurisdiction of courts in Mumbai, Maharashtra.`],
      ['10. Contact', `Questions? Email ${SUPPORT_EMAIL}.`],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    updated: '27 April 2026',
    sections: [
      ['1. What we collect', `Account info (name, email, phone, clinic). Patient health data uploaded by clinics. Payment metadata from gateways (we never store card numbers — those stay with Razorpay / PCI-DSS compliant processors).`],
      ['2. How we use it', `(a) Operate and improve the Service. (b) Generate clinic and analytics reports. (c) Communicate critical updates. (d) Comply with legal obligations.`],
      ['3. Sharing', `We do not sell your data. We share with sub-processors strictly as required: Razorpay (payments), AWS / Mongo Atlas (hosting), email & messaging vendors. All sub-processors are bound by DPA agreements.`],
      ['4. Patient health data', `Clinics are the data controller; ${COMPANY} is the data processor. Patient data is encrypted (AES-256 at rest, TLS 1.3 in transit). Premium tier offers client-controlled encryption (BYOK) where ${COMPANY} cannot decrypt patient PHI even on its own servers.`],
      ['5. Cookies', `Essential cookies for session and CSRF. No third-party advertising trackers.`],
      ['6. Your rights (DPDP Act 2023)', `You may request access, correction, erasure, or portability of your data by emailing ${SUPPORT_EMAIL}. We respond within 30 days.`],
      ['7. Retention', `Active accounts: data retained while subscription is active + 60 days. Closed accounts: data deleted within 90 days of termination.`],
      ['8. Children', `Not directed at children under 18. Parents managing patient records on behalf of minors must obtain consent under DPDP guidelines.`],
      ['9. Changes', `We may update this policy. Material changes are notified via email at least 14 days in advance.`],
      ['10. Contact', `Email our DPO at ${SUPPORT_EMAIL}.`],
    ],
  },
  refund: {
    title: 'Refund & Cancellation Policy',
    updated: '27 April 2026',
    sections: [
      ['Subscription cancellation', `You may cancel your ${COMPANY} subscription at any time from Settings → Billing. Cancellation takes effect at the end of the current billing cycle; you continue to have access until then.`],
      ['Subscription refunds', `Annual plans: pro-rata refund within the first 30 days. Monthly plans: no refund for the current month, but no further charges apply. Refunds are processed to the original payment method within 7 business days.`],
      ['Patient invoice payments', `Invoices paid by patients to clinics (e.g. hearing-aid service charges, consultations) are between the patient and the clinic. ${COMPANY} acts only as the payment facilitator. Refund decisions rest with the clinic; once the clinic approves, refund is processed via Razorpay's Refund API and reaches the patient's account in 5–7 business days.`],
      ['Disputes / chargebacks', `If you believe a payment was incorrect, please first contact your clinic. If unresolved, email ${SUPPORT_EMAIL} within 60 days of the transaction with the invoice number.`],
      ['Failed / pending payments', `If a payment is debited but not reflected in the Service within 24 hours, email ${SUPPORT_EMAIL} with your transaction reference. We co-ordinate with Razorpay to resolve within 3 business days.`],
      ['Free trial', `${COMPANY} offers a free trial. No payment is collected during the trial. Cancellation is automatic if you do not subscribe at trial end.`],
      ['Contact', `Questions about a refund? Email ${SUPPORT_EMAIL} with your invoice number.`],
    ],
  },
  contact: {
    title: 'Contact Us',
    updated: '27 April 2026',
    sections: [
      ['Support', `For technical help, account issues, or anything urgent — email ${SUPPORT_EMAIL}. Typical response within 8 working hours.`],
      ['Sales', `For demos, pricing, custom plans, or partnership — email ${SALES_EMAIL}.`],
      ['Phone', `${PHONE} (Mon–Sat, 10:00–18:00 IST).`],
      ['Office', ADDRESS],
      ['Grievance Officer (DPDP)', `Per Section 8 of DPDP Act 2023, our Grievance Officer can be reached at ${SUPPORT_EMAIL}. We acknowledge complaints within 48 hours and resolve within 30 days.`],
    ],
  },
};

export default function LegalPage() {
  const { slug: paramSlug } = useParams();
  const location = useLocation();
  const slug = paramSlug || (location.pathname.replace(/^\//, '').split('/')[0] || '').toLowerCase();
  const page = PAGES[slug];
  if (!page) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
          <Link to="/" className="text-indigo-600 hover:underline">← Back to {COMPANY}</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-white" data-testid={`legal-${slug}-page`}>
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold text-slate-900">{COMPANY}</Link>
          <nav className="flex gap-3 text-xs text-slate-600">
            <Link to="/terms" className="hover:text-slate-900">Terms</Link>
            <Link to="/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link to="/refund" className="hover:text-slate-900">Refund</Link>
            <Link to="/contact" className="hover:text-slate-900">Contact</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">{page.title}</h1>
        <p className="text-xs text-slate-500 mt-1">Last updated: {page.updated}</p>
        <div className="prose prose-slate max-w-none mt-6 space-y-5">
          {page.sections.map(([heading, body]) => (
            <section key={heading}>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 mb-1">{heading}</h2>
              <p className="text-sm text-slate-700 leading-relaxed">{body}</p>
            </section>
          ))}
        </div>
        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500">
          © {new Date().getFullYear()} {COMPANY_FULL}. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
