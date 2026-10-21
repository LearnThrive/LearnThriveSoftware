import type { Metadata } from "next";
import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { ConfirmPanel } from "@/components/account/ConfirmPanel";
import { parseTokenHash } from "@/lib/account/validation";

// The emailed link carries a one-time token in its query string, so no Referer may leave this page.
export const metadata: Metadata = { title: "Confirm | LearnThrive", referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tokenHash = parseTokenHash(params.token_hash);
  const type = params.type === "recovery" ? "recovery" : params.type === "signup" ? "signup" : null;
  return (
    <AccountShell title={type === "recovery" ? "Choose a new password" : "Confirm your email"}>
      {tokenHash && type ? (
        <ConfirmPanel tokenHash={tokenHash} kind={type} />
      ) : (
        <p>
          That link is not valid. <Link href="/login">Back to sign in</Link>
        </p>
      )}
    </AccountShell>
  );
}
