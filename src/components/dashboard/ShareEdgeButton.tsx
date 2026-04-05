"use client";

import { useEffect, useRef, useState } from "react";

type ShareEdgeButtonProps = {
  copyText: string;
};

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const didCopy = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!didCopy) {
    throw new Error("Clipboard unavailable");
  }
}

export function ShareEdgeButton({ copyText }: ShareEdgeButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  async function handleClick() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    try {
      await copyTextToClipboard(copyText);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    timeoutRef.current = window.setTimeout(() => {
      setStatus("idle");
    }, 2200);
  }

  return (
    <div className="relative inline-flex flex-col items-start gap-2 md:items-end">
      <button
        className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.06]"
        onClick={handleClick}
        type="button"
      >
        Share Today's Edge
      </button>

      {status === "idle" ? null : (
        <p
          aria-live="polite"
          className="rounded-full border border-white/10 bg-zinc-900/95 px-3 py-1 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.24em] text-zinc-300"
        >
          {status === "copied" ? "Copied to clipboard" : "Clipboard unavailable"}
        </p>
      )}
    </div>
  );
}