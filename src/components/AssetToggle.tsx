"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: { stocks: string; crypto: string }[] = [
  { stocks: "/dashboard", crypto: "/crypto/dashboard" },
  { stocks: "/track-record", crypto: "/crypto/track-record" },
  { stocks: "/briefings", crypto: "/crypto/briefings" },
];

export function AssetToggle() {
  const pathname = usePathname();

  const section = SECTIONS.find(
    (s) =>
      pathname === s.stocks ||
      pathname.startsWith(s.stocks + "/") ||
      pathname === s.crypto ||
      pathname.startsWith(s.crypto + "/"),
  );

  if (!section) return null;

  const isCrypto =
    pathname === section.crypto || pathname.startsWith(section.crypto + "/");

  return (
    <div className="inline-flex items-center rounded-md border border-white/10 bg-zinc-950 p-0.5">
      <Link
        href={section.stocks}
        className={`rounded px-3 py-1 text-xs font-medium transition ${
          !isCrypto
            ? "bg-white/10 text-white"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        Stocks
      </Link>
      <Link
        href={section.crypto}
        className={`rounded px-3 py-1 text-xs font-medium transition ${
          isCrypto
            ? "bg-white/10 text-white"
            : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        Crypto
      </Link>
    </div>
  );
}
