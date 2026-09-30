const KNOWN_SECTION_HEADERS = [
  'REGIME STATUS',
  'TRADING IMPLICATION',
  'BASE SCORE',
  'WHY IT MATTERS',
  'MODEL CONTEXT',
  'BOTTOM LINE',
  'THE BOTTOM LINE',
];

export function formatTradeDate(dateStr: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

export function formatScore(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

export function formatBiasLabel(label: string) {
  return label
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatUsd(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatWeight(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function plainLine(line: string) {
  return line.replace(/\*\*/g, '').trim();
}

function isSectionHeader(line: string) {
  const plain = plainLine(line).toUpperCase();
  return KNOWN_SECTION_HEADERS.some((header) => plain === header || plain.startsWith(`${header}:`));
}

export function extractSection(content: string, header: string): string | null {
  const lines = content.replace(/\r/g, '').split('\n');
  const headerUpper = header.toUpperCase();

  for (let index = 0; index < lines.length; index += 1) {
    const stripped = plainLine(lines[index]);
    const upper = stripped.toUpperCase();
    const inline = upper.startsWith(`${headerUpper}:`);
    const alone = upper === headerUpper;

    if (!inline && !alone) {
      continue;
    }

    const parts: string[] = [];
    const inlineBody = inline ? stripped.slice(header.length + 1).trim() : '';

    if (inlineBody) {
      parts.push(inlineBody);
    }

    for (const line of lines.slice(index + 1)) {
      const trimmed = line.trim();

      if (!trimmed) {
        if (parts.length > 0) {
          break;
        }
        continue;
      }

      if (isSectionHeader(trimmed)) {
        break;
      }

      parts.push(plainLine(trimmed));
    }

    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : null;
  }

  return null;
}

export function extractDayType(content: string, biasLabel: string) {
  const implication = extractSection(content, 'TRADING IMPLICATION');
  const match = implication?.match(/Setup:\s*(.+?)(?=\s+-\s+Focus:|$)/i);
  const sentence = match?.[1]?.replace(/\*\*/g, '').trim();

  if (sentence) {
    return sentence;
  }

  return formatBiasLabel(biasLabel);
}

export function extractBottomLine(content: string) {
  return (
    extractSection(content, 'REGIME STATUS') ??
    extractSection(content, 'BOTTOM LINE') ??
    extractSection(content, 'THE BOTTOM LINE')
  );
}

export function asFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return null;
}
