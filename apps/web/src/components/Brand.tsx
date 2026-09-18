import Image from "next/image";
import Link from "next/link";
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
      <Image
        className="brand__mark"
        src="/brand/learnthrive-mark.png"
        alt=""
        width={200}
        height={172}
        priority
      />
      <span className="brand__wordmark" aria-hidden="true">
        <span>Learn</span>
        <strong>Thrive</strong>
        <small>Tuition</small>
      </span>
    </Link>
  );
}
