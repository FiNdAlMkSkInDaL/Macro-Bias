export type BriefingHeading = { id: string; title: string; line: number; depth: number };

function displayHeading(value: string) {
  return value
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1')
    .trim();
}

export function prepareBriefingDocument(content: string, sectionHeaders: readonly string[]) {
  let fence: string | null = null;
  const lines = content.split(/\r?\n/).flatMap((line) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      return [line];
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return [line];
    const trimmed = line.trim();
    for (const header of sectionHeaders) {
      const plain = trimmed.replace(/\*\*/g, '');
      if (plain !== header && !plain.startsWith(`${header}:`)) continue;
      const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = trimmed.match(new RegExp(`^(?:\\*\\*${escaped}:?\\*\\*|${escaped})\\s*:?\\s*(.*)$`));
      if (match) return match[1] ? [`## ${header}`, '', match[1]] : [`## ${header}`];
    }
    return [line];
  });

  const headings: BriefingHeading[] = [];
  const usedIds = new Map<string, number>();
  fence = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const atx = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    const setext = index > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[index - 1].trim() && !/^\s*(?:[-*+]\s|>|#{1,6}\s)/.test(lines[index - 1]);
    if (!atx && !setext) return;
    const rawTitle = atx ? atx[2] : lines[index - 1];
    let title = displayHeading(rawTitle);
    if (sectionHeaders.includes(title)) title = title.slice(0, 1) + title.slice(1).toLowerCase();
    const base = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note'}`;
    const count = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, count);
    headings.push({ id: count === 1 ? base : `${base}-${count}`, title, line: atx ? index + 1 : index, depth: atx ? atx[1].length : line.trim().startsWith('=') ? 1 : 2 });
  });
  return { markdown: lines.join('\n'), headings };
}
