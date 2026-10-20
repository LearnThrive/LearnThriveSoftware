import { nextDeps } from "@/lib/account/next";
import { handleDownload } from "@/lib/library/download";
import { libraryStorage } from "@/lib/library/storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { rt, jar } = await nextDeps();
  return handleDownload(request, slug, { rt, jar, storage: libraryStorage() });
}
