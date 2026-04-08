import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import { cache } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { getMarketingPostBySlug } from "@/lib/marketing/markdown-parser";
import { getAppUrl } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dataFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-data",
});

const SITE_NAME = "Macro Bias";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type PublishedMarketingPostRecord = {
  published_at: string;
  slug: string;
};

type IntelArticle = {
  content: string;
  publishedAt: string;
  slug: string;
  title: string;
};

function formatPublishedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function getExcerpt(content: string, maxLength = 170) {
  const normalizedContent = content.replace(/\s+/g, " ").trim();

  if (normalizedContent.length <= maxLength) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, maxLength - 1).trimEnd()}...`;
}

const getIntelArticle = cache(async (slug: string): Promise<IntelArticle | null> => {
  const supabase = createSupabaseAdminClient();

  const [post, publishedPostResult] = await Promise.all([
    getMarketingPostBySlug(slug, "marketing"),
    supabase
      .from("published_marketing_posts")
      .select("slug, published_at")
      .eq("slug", slug)
      .maybeSingle(),
  ]);

  if (publishedPostResult.error) {
    throw new Error(
      `Failed to load published marketing post metadata for "${slug}": ${publishedPostResult.error.message}`,
    );
  }

  const publishedPost = publishedPostResult.data as PublishedMarketingPostRecord | null;

  if (!post || !publishedPost) {
    return null;
  }

  return {
    content: post.content,
    publishedAt: publishedPost.published_at,
    slug: post.slug,
    title: post.title,
  };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getIntelArticle(slug);

  if (!article) {
    return {
      title: "Intel Archive",
    };
  }

  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/intel/${article.slug}`;
  const description = getExcerpt(article.content);

  return {
    title: article.title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "article",
      url: canonicalUrl,
      siteName: SITE_NAME,
      title: article.title,
      description,
      publishedTime: article.publishedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
    },
  };
}

export default async function IntelArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getIntelArticle(slug);

  if (!article) {
    notFound();
  }

  const appUrl = getAppUrl().replace(/\/$/, "");
  const canonicalUrl = `${appUrl}/intel/${article.slug}`;
  const description = getExcerpt(article.content);
  const publishedDate = formatPublishedDate(article.publishedAt);
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description,
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    articleSection: "Market Intel",
    author: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
  };

  return (
    <main
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 text-zinc-100`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleStructuredData) }}
      />

      <div className="relative isolate overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(244,244,245,0.08),transparent_38%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_22%),linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:auto,auto,32px_32px,32px_32px] opacity-40" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10 sm:px-8 lg:px-10">
          <header className="border border-white/10 bg-zinc-950/90 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] backdrop-blur">
            <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.38em] text-zinc-500">
                [ Published Market Intel ]
              </p>
              <div className="flex items-center gap-3 font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.3em] text-zinc-400">
                <span>{publishedDate}</span>
                <span className="hidden text-zinc-700 sm:inline">/</span>
                <span>{article.slug}</span>
              </div>
            </div>

            <div className="space-y-5 px-5 py-8 sm:px-8 sm:py-10">
              <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
                Terminal Dispatch
              </p>
              <h1 className="max-w-3xl font-[family:var(--font-heading)] text-4xl font-bold tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
                {article.title}
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
                Macro Bias turns discretionary noise into regime context for active traders. This note was published to the public intel archive after distribution.
              </p>
            </div>
          </header>

          <article className="mt-8 border border-white/10 bg-zinc-950/80 px-5 py-8 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] sm:px-8 sm:py-10">
            <div className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.35em] text-zinc-600">
              [ Article Body ]
            </div>

            <div className="mt-6 text-base leading-8 text-zinc-300">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h2 className="mt-12 font-[family:var(--font-heading)] text-3xl font-bold tracking-[-0.05em] text-white first:mt-0 sm:text-4xl">
                      {children}
                    </h2>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mt-12 font-[family:var(--font-heading)] text-3xl font-bold tracking-[-0.05em] text-white sm:text-4xl">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mt-10 font-[family:var(--font-heading)] text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => <p className="mt-6 text-zinc-300 first:mt-0">{children}</p>,
                  a: ({ children, href }) => (
                    <a
                      className="font-medium text-white underline decoration-zinc-600 underline-offset-4 transition hover:decoration-zinc-200"
                      href={href}
                    >
                      {children}
                    </a>
                  ),
                  ul: ({ children }) => <ul className="mt-6 space-y-3 pl-6 text-zinc-300">{children}</ul>,
                  ol: ({ children }) => <ol className="mt-6 space-y-3 pl-6 text-zinc-300">{children}</ol>,
                  li: ({ children }) => <li className="list-disc pl-2 marker:text-zinc-500">{children}</li>,
                  blockquote: ({ children }) => (
                    <blockquote className="mt-8 border-l-2 border-zinc-700 pl-5 font-[family:var(--font-data)] text-sm uppercase tracking-[0.18em] text-zinc-400 sm:text-base">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-10 border-zinc-800" />,
                  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                  em: ({ children }) => <em className="text-zinc-100">{children}</em>,
                  pre: ({ children }) => (
                    <pre className="mt-6 overflow-x-auto border border-white/10 bg-black/40 p-4 font-[family:var(--font-data)] text-sm text-zinc-200">
                      {children}
                    </pre>
                  ),
                  code: ({ children }) => (
                    <code className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-[family:var(--font-data)] text-[0.92em] text-zinc-100">
                      {children}
                    </code>
                  ),
                }}
              >
                {article.content}
              </ReactMarkdown>
            </div>
          </article>

          <section className="mt-8 border border-white/10 bg-white/[0.03] px-5 py-8 sm:px-8 sm:py-10">
            <p className="font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.38em] text-zinc-500">
              [ Access The Model ]
            </p>
            <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h2 className="font-[family:var(--font-heading)] text-3xl font-bold tracking-[-0.05em] text-white sm:text-4xl">
                  Macro Bias is an institutional-grade regime scoring engine for active traders.
                </h2>
                <p className="mt-4 text-sm leading-7 text-zinc-400 sm:text-base">
                  Track volatility, credit, and trend in one terminal before you size risk, force conviction, or chase a broken tape.
                </p>
              </div>

              <Link
                className="inline-flex items-center justify-center border border-white/15 bg-white px-5 py-3 font-[family:var(--font-data)] text-xs font-semibold uppercase tracking-[0.28em] text-zinc-950 transition hover:bg-zinc-200"
                href="/"
              >
                Access the Terminal
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}