const STOCK_MARKET_TIME_ZONE = 'America/New_York';

const WEEKDAY_INDEX_BY_LABEL: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function newYorkCalendar(now: Date) {
  const parts = new Map(
    new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone: STOCK_MARKET_TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value] as const),
  );
  const weekday = parts.get('weekday');
  const year = parts.get('year');
  const month = parts.get('month');
  const day = parts.get('day');

  if (!weekday || !year || !month || !day) {
    throw new Error('Failed to derive the stock session date.');
  }

  const dayOfWeek = WEEKDAY_INDEX_BY_LABEL[weekday];

  if (dayOfWeek == null) {
    throw new Error(`Unsupported market weekday label: ${weekday}`);
  }

  return {
    dayOfWeek,
    iso: `${year}-${month}-${day}`,
  };
}

function shiftWeekday(isoDate: string, direction: -1 | 1) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);

  if (!match) {
    throw new Error(`Invalid session date: ${isoDate}`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

  do {
    date.setUTCDate(date.getUTCDate() + direction);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return date.toISOString().slice(0, 10);
}

/** NY cash-session date. Weekends have no session. */
export function stockSessionDate(now = new Date()) {
  const calendar = newYorkCalendar(now);

  if (calendar.dayOfWeek === 0 || calendar.dayOfWeek === 6) {
    return null;
  }

  return calendar.iso;
}

/** Previous Mon–Fri. Holidays are not removed. */
export function previousWeekday(isoDate: string) {
  return shiftWeekday(isoDate, -1);
}

/**
 * The cash session the morning job is scoring.
 * Weekday: that NY date, including before the 13:30 UTC open.
 * Weekend: the coming Monday.
 */
export function sessionAboutToOpen(now = new Date()) {
  const calendar = newYorkCalendar(now);

  if (calendar.dayOfWeek === 0 || calendar.dayOfWeek === 6) {
    return shiftWeekday(calendar.iso, 1);
  }

  return calendar.iso;
}

export function selectVisibleRow<T extends { trade_date: string }>(
  rows: T[],
  paid: boolean,
  sessionDate: string | null,
) {
  const ordered = [...rows].sort((left, right) => right.trade_date.localeCompare(left.trade_date));

  if (sessionDate == null) {
    return {
      displayTradeDate: null,
      missingSessionDate: null,
      row: paid ? (ordered[0] ?? null) : (ordered[1] ?? null),
    };
  }

  const completedBarDate = previousWeekday(sessionDate);
  const sessionRow = ordered.find((row) => row.trade_date === sessionDate) ?? null;
  const legacyRow = ordered.find((row) => row.trade_date === completedBarDate) ?? null;
  const todayRow = sessionRow ?? legacyRow;

  if (!todayRow) {
    return {
      displayTradeDate: null,
      missingSessionDate: sessionDate,
      row: paid ? null : (ordered[0] ?? null),
    };
  }

  const todayIndex = ordered.findIndex((row) => row.trade_date === todayRow.trade_date);
  const previous = ordered[todayIndex + 1] ?? null;

  return {
    // The published date is this row's trade_date. Do not relabel it as the session.
    displayTradeDate: null,
    missingSessionDate: null,
    row: paid ? todayRow : previous,
  };
}
