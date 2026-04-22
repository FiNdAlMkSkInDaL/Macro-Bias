import Link from 'next/link';

import { requireTestLabAccess } from '@/lib/test-lab/access';
import { TEST_LAB_MODULES } from '@/lib/test-lab/constants';

type ReviewItem = {
  href: string;
  label: string;
  summary: string;
};

const REVIEW_NOW: ReviewItem[] = [
  {
    href: '/test/today',
    label: 'Today Preview',
    summary: 'The only question that matters first: does this feel like a morning read traders would actually depend on?',
  },
  {
    href: '/test/experiments',
    label: 'Research Ledger',
    summary: 'The control room for what is being built, what is ready, and what still needs proof.',
  },
];

const STATUS_ORDER = {
  candidate: 0,
  experimental: 1,
  research: 2,
  ready: 3,
} as const;

const STATUS_STYLES: Record<string, string> = {
  candidate: 'text-emerald-300',
  experimental: 'text-amber-300',
  research: 'text-sky-300',
  ready: 'text-violet-300',
};

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export const dynamic = 'force-dynamic';

export default async function TestLabHomePage() {
  const user = await requireTestLabAccess();

  const orderedModules = [...TEST_LAB_MODULES].sort(
    (left, right) =>
      STATUS_ORDER[left.status as keyof typeof STATUS_ORDER] -
        STATUS_ORDER[right.status as keyof typeof STATUS_ORDER] ||
      left.title.localeCompare(right.title),
  );

  return (
    <div className="space-y-16">
      <header className="grid gap-12 border-b border-white/10 pb-12 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Private Research Environment
          </p>
          <h1 className="mt-4 max-w-3xl font-[family:var(--font-heading)] text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Build less. Prove more. Promote only what deserves live.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-300">
            Signed in as {user.email}. This is not a user-facing product surface. It is the private
            place where we sharpen the one feature worth promoting next, instead of drowning
            ourselves in dashboards.
          </p>
        </div>

        <div className="space-y-8">
          <div>
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              Start Here
            </p>
            <div className="mt-4 space-y-4">
              {REVIEW_NOW.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block border-b border-white/10 pb-4 transition hover:border-white/30"
                >
                  <p className="text-lg font-semibold text-white">{item.label}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{item.summary}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="border-l border-amber-400/30 pl-5">
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              Working Rule
            </p>
            <p className="mt-3 text-sm leading-7 text-zinc-300">
              If it does not make the morning product clearer, sharper, and more habit-forming, it
              stays in the lab.
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Immediate Focus
          </p>
          <h2 className="mt-4 font-[family:var(--font-heading)] text-3xl font-semibold text-white">
            The first serious live candidate is the morning trust read.
          </h2>
          <div className="mt-5 space-y-4 text-base leading-8 text-zinc-300">
            <p>
              We are not trying to make users admire the system. We are trying to make them feel
              worse off when they do not check it before the open.
            </p>
            <p>
              That means the first promotion target is not the regime map, not the cockpit, and not
              the research process. It is one strong morning read that tells people whether the
              score deserves trust today.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="border-t border-white/10 pt-4">
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
              Review Order
            </p>
          </div>
          <div className="space-y-4 text-sm leading-7 text-zinc-300">
            <p>1. `Today Preview` should stop the scroll immediately.</p>
            <p>2. It should get more insightful the longer you stay with it.</p>
            <p>3. `Research Ledger` should stay useful without stealing focus.</p>
          </div>
        </div>
      </section>

      <section>
        <div className="border-t border-white/10 pt-6">
          <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
            Promotion Queue
          </p>
          <h2 className="mt-3 font-[family:var(--font-heading)] text-2xl font-semibold text-white">
            What each module is for
          </h2>
        </div>

        <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
          {orderedModules.map((module) => (
            <Link
              key={module.slug}
              href={`/test/${module.slug}`}
              className="grid gap-4 px-1 py-5 transition hover:bg-white/[0.02] md:grid-cols-[0.85fr_0.18fr_1fr]"
            >
              <div>
                <p className="text-lg font-semibold text-white">{module.title}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{module.summary}</p>
              </div>
              <div className="md:pt-1">
                <span
                  className={`font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.28em] ${
                    module.status === 'candidate'
                      ? STATUS_STYLES[module.status]
                      : 'text-zinc-500'
                  }`}
                >
                  {formatStatus(module.status)}
                </span>
              </div>
              <div className="text-sm leading-6 text-zinc-300">{module.outcome}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
