export interface TimeTrackerEntry {
  name: string;
  startTime: string | null;
  endTime: string | null;
  subEntries?: TimeTrackerEntry[];
}

export interface TimeTracker {
  entries: TimeTrackerEntry[];
}

export interface ParsedTimeTracker {
  tracker: TimeTracker;
  language: 'timekeep' | 'simple-time-tracker';
  startIndex: number;
  endIndex: number;
}

export function parseTimeTrackersFromMarkdown(md: string): ParsedTimeTracker[] {
  const results: ParsedTimeTracker[] = [];
  const regex = /```(?:timekeep|simple-time-tracker) *\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(md)) !== null) {
    try {
      const content = match[1].trim();
      const tracker = JSON.parse(content) as TimeTracker;
      const language = match[0].startsWith('```timekeep') ? 'timekeep' : 'simple-time-tracker';

      results.push({
        tracker,
        language,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    } catch (e) {
      console.error(
        '[Kanban] Failed to parse time tracker block:',
        e,
        '- Ensure the JSON format is correct and entries have valid timestamps'
      );
    }
  }

  return results;
}

function findInnermostOpenEntry(entries: TimeTrackerEntry[]): TimeTrackerEntry | null {
  const lastEntry = entries[entries.length - 1];
  if (!lastEntry) return null;

  if (lastEntry.endTime === null) {
    return lastEntry;
  }

  if (lastEntry.subEntries && lastEntry.subEntries.length > 0) {
    return findInnermostOpenEntry(lastEntry.subEntries);
  }

  return null;
}

export function calculateTimes(tracker: TimeTracker): {
  totalMs: number;
  currentMs: number | null;
  isRunning: boolean;
} {
  let totalMs = 0;
  let latestStart: number | null = null;

  function processEntry(entry: TimeTrackerEntry) {
    if (entry.subEntries) {
      entry.subEntries.forEach(processEntry);
    }

    if (!entry.startTime) return;

    const start = new Date(entry.startTime).getTime();

    if (!entry.endTime) {
      if (!latestStart || start > latestStart) {
        latestStart = start;
      }
    }

    const duration = entry.endTime ? new Date(entry.endTime).getTime() - start : Date.now() - start;
    totalMs += duration;

  }

  tracker.entries.forEach(processEntry);

  return {
    totalMs,
    currentMs: latestStart ? Date.now() - latestStart : null,
    isRunning: latestStart !== null,
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

export interface TimeTrackerData {
  tracker: TimeTracker;
  language: 'timekeep' | 'simple-time-tracker';
  startIndex: number;
  endIndex: number;
  totalTimeFormatted: string;
  currentTimeFormatted: string | null;
  isRunning: boolean;
  filePath?: string;
}

export function getTimeTrackerData(parsed: ParsedTimeTracker): TimeTrackerData {
  const { totalMs, currentMs, isRunning } = calculateTimes(parsed.tracker);

  return {
    tracker: parsed.tracker,
    language: parsed.language,
    startIndex: parsed.startIndex,
    endIndex: parsed.endIndex,
    totalTimeFormatted: formatDuration(totalMs),
    currentTimeFormatted: currentMs !== null ? formatDuration(currentMs) : null,
    isRunning,
  };
}

function createNewEntry(
  tracker: TimeTracker,
  language: 'timekeep' | 'simple-time-tracker'
): TimeTrackerEntry {
  const blockCount = tracker.entries.length + 1;
  const entry: TimeTrackerEntry = {
    name: `Block ${blockCount}`,
    startTime: new Date().toISOString(),
    endTime: null,
  };

  if (language === 'timekeep') {
    entry.subEntries = null;
  }

  return entry;
}

export function addTimeEntry(
  tracker: TimeTracker,
  language: 'timekeep' | 'simple-time-tracker' = 'simple-time-tracker'
): TimeTrackerEntry {
  const newEntry = createNewEntry(tracker, language);
  tracker.entries.push(newEntry);
  return newEntry;
}

export function stopTimeEntry(tracker: TimeTracker): boolean {
  const openEntry = findInnermostOpenEntry(tracker.entries);
  if (!openEntry) return false;

  openEntry.endTime = new Date().toISOString();
  return true;
}
