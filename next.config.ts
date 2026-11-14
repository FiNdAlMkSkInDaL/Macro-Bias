import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // The sitemap reads guide files again when it regenerates on the server.
  outputFileTracingIncludes: {
    '/sitemap.xml': ['./src/content/marketing/*.md'],
  },
};

export default nextConfig;
