import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/LegalPage";
import { termsApproved } from "@/lib/billing/config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";

/** In production the page exists only once the owners and a solicitor have approved it (LIBRARY_TERMS_APPROVED=true). */
const visible = () => process.env.NODE_ENV !== "production" || termsApproved();

export function generateMetadata(): Metadata {
  return {
    ...createMetadata({
      title: "Library terms and content licence",
      description: "The terms for the LearnThrive Library: what you get, how the licence works, billing, cancelling and refunds.",
      path: "/library/terms",
    }),
    robots: visible() && termsApproved() ? undefined : { index: false, follow: false },
  };
}

/**
 * The Library subscription terms and content licence (plan19 phase E). DRAFT WORDING: it has not been through a solicitor,
 * and every bracketed item is the owners' to settle. It is a 404 in production until LIBRARY_TERMS_APPROVED=true, and while it
 * is not approved (development) it says so at the top. Approving it means editing this file with the reviewer's wording,
 * then setting the variable (docs/BILLING.md, apps/web/LEGAL_REVIEW.md).
 */
export default function LibraryTermsPage() {
  if (!visible()) notFound();
  const approved = termsApproved();
  return (
    <LegalPage
      path="/library/terms"
      eyebrow="Library"
      title="Library terms and content licence"
      intro="What you get with the LearnThrive Library, what you may do with it, and how paying, cancelling and refunds work."
      reviewedOn={approved ? "Approved by the owners" : "Draft, not yet reviewed"}
      scope={
        <>
          {approved ? null : (
            <p>
              <strong>Draft for the owners and a legal reviewer.</strong> This wording is not in force and must not be relied on. It becomes the Library terms only when the owners and a solicitor have approved it.
            </p>
          )}
          <p>
            These terms apply to the LearnThrive Library, a collection of worksheets, exam-style papers, mark schemes and notes made by LearnThrive. They
            sit alongside our <a href="/privacy">privacy notice</a> and, if your child has tuition with us, our <a href="/tuition-terms">tuition terms</a>.
          </p>
          <p>
            The Library is provided by LearnThrive Tuition. [OWNER TO CONFIRM: the legal name, company number and registered address of the business that
            contracts with subscribers.] You can contact us at <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
          </p>
        </>
      }
      sections={[
        {
          id: "what-you-get",
          title: "What you get",
          content: (
            <>
              <p>
                Access to the Library is included for students enrolled with LearnThrive. Anyone else can pay a subscription for access to all of it. While your
                access is open you can browse, search and download what is in the Library.
              </p>
              <p>
                We add to and change the Library from time to time, and we may remove a resource. We do not promise a number of resources, or that a particular
                topic or exam board will be covered. The material is study support: it does not guarantee a grade, a result or a school place.
              </p>
            </>
          ),
        },
        {
          id: "licence",
          title: "Your licence",
          content: (
            <>
              <p>
                We give you a personal, non-transferable licence to download the material and use it for your own study, or to help your own child study, in
                your own home.
              </p>
              <p>You may not share it with anyone outside your household, post it on a website, app, forum or group chat, sell, lend or hire it out, or put it into an AI tool to train or improve it. Every PDF you download carries your name and the date; that is so a copy that is shared can be traced, and it must not be removed.</p>
              <p>The material stays LearnThrive&rsquo;s. [OWNER TO CONFIRM: wording on teachers and tutors who are not LearnThrive tutors, and on schools.]</p>
            </>
          ),
        },
        {
          id: "account",
          title: "Your account",
          content: (
            <>
              <p>
                An account is for an adult (18 or over), who is the account holder. Students under 18 use a profile under a parent or guardian&rsquo;s account.
                Keep your password to yourself and tell us if you think someone else has used your account. We may suspend an account that is shared.
              </p>
            </>
          ),
        },
        {
          id: "price-and-renewal",
          title: "Price, payment and renewal",
          content: (
            <>
              <p>
                The price, and whether it includes VAT, is shown next to the button before you pay. You pay when you subscribe and then again at the start of
                every period, monthly or yearly depending on the plan you chose. <strong>The subscription renews automatically until you cancel it.</strong> We email you before each renewal.
              </p>
              <p>
                Payments are taken by Stripe, on Stripe&rsquo;s own secure page. We never see or keep your card number. [OWNER TO CONFIRM: how much notice you
                will give before a price change, and what happens if the customer does not accept it.]
              </p>
            </>
          ),
        },
        {
          id: "cancelling",
          title: "Cancelling",
          content: (
            <p>
              You can cancel at any time, online: sign in, open your account and choose Manage billing. Cancelling stops the next renewal. You keep access to the
              end of the period you have already paid for. There is nothing to phone or write. We do not refund part of a period you have already used, except
              where the law or the refunds section below says we should.
            </p>
          ),
        },
        {
          id: "right-to-cancel",
          title: "Your 14-day right to cancel, and digital content",
          content: (
            <>
              <p>
                When you buy something online you normally have 14 days to change your mind. The Library is digital content that we make available as soon as you
                subscribe. At checkout we ask you to confirm that you want access to start straight away and that you understand you lose your 14-day right to
                cancel once access begins. If you do not confirm, you cannot subscribe.
              </p>
              <p>This does not affect your legal rights if something is faulty or not as described. [OWNER AND SOLICITOR TO CONFIRM this wording against the Consumer Contracts Regulations and the new subscription rules.]</p>
            </>
          ),
        },
        {
          id: "refunds",
          title: "Refunds",
          content: (
            <p>
              If you think you should have a refund, contact us within 14 days of paying and tell us why. We look at each request fairly and in line with your legal
              rights. If we agree a full refund of a payment, your access for that subscription ends at once. [OWNER TO CONFIRM the policy beyond the legal minimum.]
            </p>
          ),
        },
        {
          id: "fair-use",
          title: "Fair use and suspension",
          content: (
            <p>
              There is a limit on how many files one account can download in an hour (currently 60), so that the Library is not copied in bulk. We may suspend or end
              an account that breaks the licence above or these terms, and will tell you why. If we end a paid subscription because of something we got wrong, we refund the unused part.
            </p>
          ),
        },
        {
          id: "responsibility",
          title: "Our responsibility",
          content: (
            <p>
              Nothing in these terms limits your legal rights as a consumer, or our liability for death or personal injury caused by our negligence, for fraud, or
              for anything else the law does not allow us to limit. [OWNER AND SOLICITOR TO CONFIRM the rest.]
            </p>
          ),
        },
        {
          id: "changes-and-law",
          title: "Changes, and the law",
          content: (
            <p>
              We may change these terms, and will tell you before a change that affects you takes effect. These terms are governed by the law of England and Wales,
              and you can bring a claim in the courts where you live. [OWNER AND SOLICITOR TO CONFIRM.]
            </p>
          ),
        },
      ]}
    />
  );
}
