import Image from "next/image";
import { PRODUCT_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function Brand({ wordmarkClassName }: { wordmarkClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/branding/pingufunk-mark.svg"
        alt=""
        width={40}
        height={40}
        className="shrink-0"
      />
      <span className={cn("text-xl font-bold tracking-tight whitespace-nowrap", wordmarkClassName)}>
        {PRODUCT_NAME}
      </span>
    </span>
  );
}
