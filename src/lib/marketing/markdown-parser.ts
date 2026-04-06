import 'server-only';

import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

export const MARKETING_POST_TYPES = ['weather', 'close', 'marketing'] as const;

export type MarketingPostType = (typeof MARKETING_POST_TYPES)[number];

export type MarketingPost = {
  content: string;
  filePath: string;
  slug: string;
  type: MarketingPostType;
};

type ParsedFrontmatter = {
  campaignType?: string;
  slug?: string;
};

const MARKETING_CONTENT_ROOT = path.join(process.cwd(), 'src', 'content', 'marketing');

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isMarkdownFile(fileName: string) {
  return /\.md$/i.test(fileName);
}

function getCampaignType(value: unknown): MarketingPostType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  return isMarketingPostType(trimmedValue) ? trimmedValue : null;
}

function getSlug(value: unknown, fileName: string) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return fileName.replace(/\.md$/i, '');
}

export function isMarketingPostType(value: string | null): value is MarketingPostType {
  return value != null && MARKETING_POST_TYPES.some((postType) => postType === value);
}

export async function getAllMarketingPosts(type: MarketingPostType): Promise<MarketingPost[]> {
  let entries: Dirent<string>[] = [];

  try {
    entries = await readdir(MARKETING_CONTENT_ROOT, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw new Error(`Failed to read marketing posts from \"${MARKETING_CONTENT_ROOT}\".`);
  }

  const fileEntries = entries
    .filter((entry) => entry.isFile() && isMarkdownFile(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  const posts = await Promise.all(
    fileEntries.map(async (entry) => {
      const filePath = path.join(MARKETING_CONTENT_ROOT, entry.name);
      const document = await readFile(filePath, 'utf8');
      const { content, data } = matter(document);
      const frontmatter = data as ParsedFrontmatter;
      const campaignType = getCampaignType(frontmatter.campaignType);

      if (campaignType !== type) {
        return null;
      }

      const trimmedContent = content.trim();
      const slug = getSlug(frontmatter.slug, entry.name);

      if (!trimmedContent || !slug) {
        return null;
      }

      return {
        content: trimmedContent,
        filePath,
        slug,
        type: campaignType,
      } satisfies MarketingPost;
    }),
  );

  return posts.filter((post): post is MarketingPost => post !== null);
}