import Link from 'next/link';

import type { TestLabModule } from '@/lib/test-lab/constants';

const STATUS_STYLES: Record<string, string> = {
  research: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  experimental: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  candidate: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  ready: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
};

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function TestLabStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] ${
        STATUS_STYLES[status] ?? 'border-white/15 bg-white/5 text-zinc-300'
      }`}
    >
      {formatStatus(status)}
    </span>
  );
}

export function TestLabPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  actions?: React.ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-6 border-b border-white/10 pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.38em] text-amber-300">
          {eyebrow}
        </p>
        <h1 className="mt-4 font-[family:var(--font-heading)] text-4xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-300 sm:text-base">
          {description}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export function TestLabLinkButton({
  href,
  label,
  subtle = false,
}: {
  href: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        subtle
          ? 'inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white'
          : 'inline-flex items-center rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200'
      }
    >
      {label}
    </Link>
  );
}

export function TestLabModuleCard({ module }: { module: TestLabModule }) {
  return (
    <Link
      href={`/test/${module.slug}`}
      className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/20 hover:bg-white/[0.04]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-[family:var(--font-heading)] text-xl font-semibold text-white">
            {module.title}
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{module.summary}</p>
        </div>
        <TestLabStatusPill status={module.status} />
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">Target Output</p>
        <p className="mt-2 text-sm leading-6 text-zinc-300">{module.outcome}</p>
      </div>
      <div className="mt-4 text-sm font-medium text-white/80 transition group-hover:text-white">
        Open module
      </div>
    </Link>
  );
}

export function TestLabChecklist({
  title,
  items,
}: {
  items: readonly string[];
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">{title}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item} className="flex gap-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-sky-400" />
            <p className="text-sm leading-6 text-zinc-300">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TestLabMetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  subtext: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">{label}</p>
      <p className="mt-2 font-[family:var(--font-data)] text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{subtext}</p>
    </div>
  );
}
