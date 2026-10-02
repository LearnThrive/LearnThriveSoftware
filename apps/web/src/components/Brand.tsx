import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { siteConfig } from "@/lib/site";

type BrandProps = {
  inverse?: boolean;
};

export function Brand({ inverse = false }: BrandProps) {
  return (
    <Link
      className={`brand ${inverse ? "brand--inverse" : ""}`.trim()}
      href="/"
      aria-label={`${siteConfig.name} home`}
    >
      <BrandMark className="brand__mark" />
      <span className="brand__wordmark" aria-hidden="true">
        <span>Learn</span>
        <strong>Thrive</strong>
        <small>Tuition</small>
      </span>
    </Link>
  );
}
