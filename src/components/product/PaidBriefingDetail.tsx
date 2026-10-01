import Link from 'next/link';
import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { DAILY_BRIEFING_SECTION_HEADERS } from '@/lib/briefing/daily-briefing-config';
import { CRYPTO_BRIEFING_SECTION_HEADERS } from '@/lib/crypto-briefing/crypto-briefing-config';
import type { PaidBriefingDetailData, PaidBriefingDocument } from '@/lib/product/paid-briefing-data';
import type { ProductAsset } from '@/lib/product/score-access';
import { getAppUrl } from '@/lib/server-env';
import { MemberShell, MarketTabs } from './MemberShell';
import { ArrowIcon } from './ArrowIcon';
import { briefingBasePath, briefingDate, briefingLabel, briefingScore, briefingTone } from './PaidBriefingArchive';
import { prepareBriefingDocument, type BriefingHeading } from './briefing-document';
import shared from './MemberUI.module.css';
import styles from './PaidBriefing.module.css';

function generatedTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
  const date = new Date(value);
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date);
  return `${day}, ${time} UTC`;
}

function Contents({ headings }: { headings: BriefingHeading[] }) {
  return <nav aria-label="Briefing contents"><ul className={styles.contentsList}>{headings.map((heading) => <li key={heading.id}><a href={`#${heading.id}`}>{heading.title}</a></li>)}</ul></nav>;
}

function StockStructuredData({ briefing }: { briefing: PaidBriefingDocument }) {
  const appUrl = getAppUrl().replace(/\/$/, '');
  const canonicalUrl = `${appUrl}/briefings/${briefing.briefingDate}`;
  const displayDate = briefingDate(briefing.briefingDate, true);
  const displayLabel = briefing.biasLabel.replace(/_/g, ' ');
  const displayScore = briefingScore(briefing.score);
  const description = `Macro Bias scored ${displayLabel} (${displayScore}) on ${displayDate}.`;
  const article = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: `${displayLabel} (${displayScore}) — ${displayDate}`, description,
    datePublished: briefing.generatedAt, dateModified: briefing.generatedAt,
    mainEntityOfPage: canonicalUrl, url: canonicalUrl, articleSection: 'Daily Macro Briefing',
    author: { '@type': 'Organization', name: 'Macro Bias' },
    publisher: { '@type': 'Organization', name: 'Macro Bias', url: appUrl, logo: { '@type': 'ImageObject', url: `${appUrl}/icon.png` } },
    isPartOf: { '@type': 'WebSite', name: 'Macro Bias', url: appUrl },
    about: { '@type': 'FinancialProduct', name: 'Macro Bias Daily Regime Score', description: `Quantitative macro regime score of ${displayScore} (${displayLabel}) computed across SPY, TLT, GLD, USO, and HYG for ${displayDate}.`, category: 'Financial Analytics' },
    keywords: ['macro bias', 'regime score', displayLabel.toLowerCase(), 'day trading', 'macro regime', briefing.briefingDate],
  };
  const breadcrumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: appUrl },
      { '@type': 'ListItem', position: 2, name: 'Briefings', item: `${appUrl}/briefings` },
      { '@type': 'ListItem', position: 3, name: displayDate, item: canonicalUrl },
    ],
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(article).replace(/</g, '\\u003c') }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, '\\u003c') }} /></>;
}

export function PaidBriefingDetail({ asset, date, data }: { asset: ProductAsset; date: string; data: PaidBriefingDetailData }) {
  const { briefing, archive, loadError } = data;
  const basePath = briefingBasePath(asset);
  const workspacePath = asset === 'stocks' ? '/dashboard' : '/crypto/dashboard';
  const dailyPath = asset === 'stocks' ? '/today' : '/crypto';
  const title = asset === 'stocks' ? 'Stock briefing' : 'Crypto briefing';
  if (!briefing) return (
    <MemberShell title={title} description={briefingDate(date, true)} plan="Pro plan" narrow>
      <MarketTabs asset={asset} view="briefings" />
      <div className={shared.notice} role="status">{loadError ?? 'This briefing is not available.'}</div>
      <div className={shared.actions}><Link className={shared.textLink} href={basePath}>All briefings<ArrowIcon /></Link><Link className={shared.textLink} href={workspacePath}>Open workspace<ArrowIcon /></Link><Link className={shared.textLink} href={dailyPath}>Daily reading<ArrowIcon /></Link></div>
    </MemberShell>
  );

  const headers = Object.values(asset === 'stocks' ? DAILY_BRIEFING_SECTION_HEADERS : CRYPTO_BRIEFING_SECTION_HEADERS);
  const document = prepareBriefingDocument(briefing.content, headers);
  const headingsByLine = new Map(document.headings.map((heading) => [heading.line, heading]));
  const previous = archive.items.find((item) => item.date < briefing.briefingDate);
  const next = [...archive.items].reverse().find((item) => item.date > briefing.briefingDate);
  const headingRenderer = (level: 2 | 3 | 4 | 5 | 6) => {
    function Heading({ node, children }: ComponentProps<'h2'> & ExtraProps) {
      const heading = headingsByLine.get(node?.position?.start.line ?? -1);
      const knownHeading = heading && headers.some((header) => header.toLowerCase() === heading.title.toLowerCase());
      const props = { id: heading?.id, className: styles.articleHeading, children: knownHeading ? heading.title : children };
      if (level === 3) return <h3 {...props} />;
      if (level === 4) return <h4 {...props} />;
      if (level === 5) return <h5 {...props} />;
      if (level === 6) return <h6 {...props} />;
      return <h2 {...props} />;
    }
    return Heading;
  };

  return (
    <MemberShell title={title} description={<time dateTime={briefing.briefingDate}>{briefingDate(briefing.briefingDate, true)}</time>} plan="Pro plan" narrow>
      {asset === 'stocks' ? <StockStructuredData briefing={briefing} /> : null}
      <div className={styles.readerGrid} data-paid-briefing>
        <div className={styles.readerMain}>
          <div className={styles.readerToolbar}><MarketTabs asset={asset} view="briefings" /><div className={styles.links}><Link className={shared.textLink} href={workspacePath}>Open workspace</Link><Link className={shared.textLink} href={basePath}>All briefings</Link></div></div>
          <dl className={styles.readingStrip}>
            <div><dt>Briefing reading</dt><dd><span className={briefingTone(briefing.biasLabel)}>{briefingScore(briefing.score)}</span><span>{briefingLabel(briefing.biasLabel)}</span></dd></div>
            <div><dt>Source session</dt><dd><time dateTime={briefing.tradeDate}>{briefingDate(briefing.tradeDate)}</time></dd></div>
            <div><dt>Generated</dt><dd>{generatedTime(briefing.generatedAt)}</dd></div>
          </dl>
          {document.headings.length ? <details className={styles.mobileContents}><summary>Contents</summary><Contents headings={document.headings} /></details> : null}
          {briefing.overrideActive ? <p className={styles.overrideNotice}>Override active for this briefing.</p> : null}
          <article className={styles.article} aria-label={`Full ${asset === 'stocks' ? 'stock' : 'crypto'} briefing`}>
            {briefing.content.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: headingRenderer(2), h2: headingRenderer(2), h3: headingRenderer(3), h4: headingRenderer(4), h5: headingRenderer(5), h6: headingRenderer(6), table: ({ children }) => <div className={styles.markdownTable}><table>{children}</table></div> }}>{document.markdown}</ReactMarkdown>
              : <div className={shared.notice}>The stored briefing has no text available.</div>}
          </article>
          <nav className={styles.adjacent} aria-label="Adjacent briefings">
            <div>{previous ? <Link href={`${basePath}/${previous.date}`}><span className={styles.previousArrow}><ArrowIcon /></span><span>Previous briefing<time dateTime={previous.date}>{briefingDate(previous.date)}</time></span></Link> : null}</div>
            <Link className={styles.archiveLink} href={basePath}>Briefing archive</Link>
            <div>{next ? <Link className={styles.nextLink} href={`${basePath}/${next.date}`}><span>Next briefing<time dateTime={next.date}>{briefingDate(next.date)}</time></span><ArrowIcon /></Link> : null}</div>
          </nav>
          {archive.loadError ? <p className={styles.navigationNotice} role="status">Adjacent briefing navigation is unavailable. <Link href={basePath}>Open the archive</Link>.</p> : null}
          <Link className={shared.textLink} href={dailyPath}>Daily reading<ArrowIcon /></Link>
        </div>
        <aside className={styles.rail} aria-label="Briefing navigation and details">
          {document.headings.length ? <section><h2>Contents</h2><Contents headings={document.headings} /></section> : null}
          <section className={styles.details}><h2>Briefing details</h2><dl>
            <div><dt>Asset class</dt><dd>{asset === 'stocks' ? 'Stocks' : 'Crypto'}</dd></div>
            <div><dt>Briefing date</dt><dd><time dateTime={briefing.briefingDate}>{briefingDate(briefing.briefingDate)}</time></dd></div>
            <div><dt>Source session</dt><dd><time dateTime={briefing.tradeDate}>{briefingDate(briefing.tradeDate)}</time></dd></div>
            <div><dt>Generated</dt><dd>{generatedTime(briefing.generatedAt)}</dd></div>
            <div><dt>Reading</dt><dd><span className={briefingTone(briefing.biasLabel)}>{briefingScore(briefing.score)}</span> {briefingLabel(briefing.biasLabel)}</dd></div>
            {briefing.modelVersion ? <div><dt>Model</dt><dd>{briefing.modelVersion}</dd></div> : null}
            <div><dt>Override</dt><dd>{briefing.overrideActive ? 'Active' : 'Not active'}</dd></div>
          </dl></section>
        </aside>
      </div>
    </MemberShell>
  );
}
