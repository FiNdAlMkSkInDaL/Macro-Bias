import type { Metadata } from "next";
import { stat } from "node:fs/promises";
import Link from "next/link";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { notFound } from "next/navigation";
import { cache } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  getAllMarketingPosts,
  getMarketingPostBySlug,
  type MarketingPost,
} from "@/lib/marketing/markdown-parser";
import { getAppUrl } from "@/lib/server-env";

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

export const dynamicParams = false;

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

type IntelArticle = MarketingPost & {
  publishedAt: string;
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
  const post = await getMarketingPostBySlug(slug, "marketing");

  if (!post) {
    return null;
  }

  const fileStats = await stat(post.filePath);

  return {
    ...post,
    publishedAt: fileStats.mtime.toISOString(),
  };
});

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const posts = await getAllMarketingPosts("marketing");

  return posts.map((post) => ({ slug: post.slug }));
}

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
      className={`${headingFont.variable} ${dataFont.variable} min-h-screen bg-zinc-950 font-[family:var(--font-heading)] text-zinc-100`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleStructuredData) }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="border border-white/10 bg-zinc-950">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
              [ Published Market Intel ]
            </p>
            <div className="flex items-center gap-3 font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              <span>{publishedDate}</span>
              <span className="hidden text-zinc-700 sm:inline">/</span>
              <span>{article.slug}</span>
            </div>
          </div>

          <div className="space-y-5 px-5 py-8 sm:px-8 sm:py-10">
            <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
              Terminal Dispatch
            </p>
            <h1 className="max-w-3xl font-[family:var(--font-heading)] text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl lg:text-6xl">
              {article.title}
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
              {description}
            </p>
          </div>
        </header>

        <article className="mt-6 border border-white/10 bg-zinc-950 px-5 py-8 sm:px-8 sm:py-10">
          <div className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-600">
            [ Article Body ]
          </div>

          <div className="mt-6 text-base leading-8 text-zinc-300">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h2 className="mt-12 font-[family:var(--font-heading)] text-3xl font-semibold tracking-[-0.05em] text-white first:mt-0 sm:text-4xl">
                    {children}
                  </h2>
                ),
                h2: ({ children }) => (
                  <h2 className="mt-12 font-[family:var(--font-heading)] text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">
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
                ul: ({ children }) => <ul className="mt-6 list-disc space-y-3 pl-6 text-zinc-300">{children}</ul>,
                ol: ({ children }) => <ol className="mt-6 list-decimal space-y-3 pl-6 text-zinc-300">{children}</ol>,
                li: ({ children }) => <li className="pl-2 marker:text-zinc-500">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="mt-8 border-l-2 border-zinc-700 pl-5 font-[family:var(--font-data)] text-sm leading-7 text-zinc-400 sm:text-base">
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
                code: ({ children, className }) =>
                  className ? (
                    <code className={`${className} font-[family:var(--font-data)] text-sm text-zinc-100`}>
                      {children}
                    </code>
                  ) : (
                    <code className="border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-[family:var(--font-data)] text-[0.92em] text-zinc-100">
                      {children}
                    </code>
                  ),
                table: ({ children }) => (
                  <div className="mt-8 overflow-x-auto">
                    <table className="w-full border-collapse border border-white/10 text-left text-sm text-zinc-300">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-white/[0.03]">{children}</thead>,
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr className="border-t border-white/10">{children}</tr>,
                th: ({ children }) => (
                  <th className="px-4 py-3 font-[family:var(--font-data)] text-[11px] uppercase tracking-[0.24em] text-zinc-400">
                    {children}
                  </th>
                ),
                td: ({ children }) => <td className="px-4 py-3 align-top text-zinc-300">{children}</td>,
              }}
            >
              {article.content}
            </ReactMarkdown>
          </div>
        </article>

        <section className="mt-6 border border-white/10 bg-white/[0.03] px-5 py-8 sm:px-8 sm:py-10">
          <p className="font-[family:var(--font-data)] text-[10px] uppercase tracking-[0.42em] text-zinc-500">
            [ Access The Model ]
          </p>
          <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-[family:var(--font-heading)] text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">
                Macro Bias is an institutional-grade regime scoring engine for active traders.
              </h2>
              <p className="mt-4 text-sm leading-7 text-zinc-400 sm:text-base">
                Track volatility, credit, trend, and positioning in one terminal before you size risk, force conviction, or chase a broken tape.
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
    </main>
  );
}