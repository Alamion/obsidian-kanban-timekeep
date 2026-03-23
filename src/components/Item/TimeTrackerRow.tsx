import { Notice, TFile } from 'obsidian';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/compat';

import {
  TimeTrackerData,
  addTimeEntry,
  calculateTimes,
  formatDuration,
  getTimeTrackerData,
  parseTimeTrackersFromMarkdown,
  stopTimeEntry,
} from '../../parsers/parseTimeTrackers';
import { Icon } from '../Icon/Icon';
import { KanbanContext } from '../context';
import { c } from '../helpers';

const trackerCache = new Map<string, { data: TimeTrackerData[]; timestamp: number }>();
const CACHE_TTL = 5000;

export function getTimeTrackersFromFile(md: string, filePath?: string): TimeTrackerData[] {
  const cacheKey = filePath || md.substring(0, 100);

  const cached = trackerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const parsed = parseTimeTrackersFromMarkdown(md);
  const data = parsed.map((p) => getTimeTrackerData(p));

  trackerCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

export async function toggleTimeTracker(
  stateManager: any,
  filePath: string,
  trackerData: TimeTrackerData
): Promise<void> {
  const file = stateManager.app.vault.getAbstractFileByPath(filePath);
  if (!file || !(file instanceof TFile)) {
    new Notice('Linked file not found');
    return;
  }

  const md = await stateManager.app.vault.read(file);
  const trackers = parseTimeTrackersFromMarkdown(md);

  const trackerIndex = trackers.findIndex(
    (t) => t.startIndex === trackerData.startIndex && t.endIndex === trackerData.endIndex
  );

  if (trackerIndex === -1) {
    new Notice('Time tracker not found in file');
    return;
  }

  const tracker = trackers[trackerIndex].tracker;
  const language = trackers[trackerIndex].language;

  if (trackerData.isRunning) {
    const success = stopTimeEntry(tracker);
    if (!success) {
      new Notice('No active timer to stop');
      return;
    }
  } else {
    addTimeEntry(tracker, language);
  }

  const newContent = JSON.stringify({ entries: tracker.entries });
  const before = md.substring(0, trackerData.startIndex);
  const after = md.substring(trackerData.endIndex);

  const lang = trackerData.language === 'timekeep' ? 'timekeep' : 'simple-time-tracker';
  const newCodeBlock = `\`\`\`${lang}\n${newContent}\n\`\`\``;

  const newMd = before + newCodeBlock + after;

  try {
    await stateManager.app.vault.modify(file, newMd);
    trackerCache.delete(filePath);
    new Notice(trackerData.isRunning ? 'Timer stopped' : 'Timer started');
  } catch (e) {
    console.error(
      '[Kanban] Failed to update time tracker:',
      e,
      '- Check file permissions and format'
    );
    new Notice('Failed to update time tracker: ' + (e as Error).message);
  }
}

interface TimeTrackerDisplayProps {
  trackerData: TimeTrackerData;
  onToggle: () => void;
}

export function TimeTrackerDisplay({ trackerData, onToggle }: TimeTrackerDisplayProps) {
  const memoizedTimes = useMemo(() => calculateTimes(trackerData.tracker), [trackerData.tracker]);

  const [displayTime, setDisplayTime] = useState<{ total: string; current: string | null }>({
    total: memoizedTimes.isRunning
      ? formatDuration(memoizedTimes.totalMs)
      : trackerData.totalTimeFormatted,
    current: memoizedTimes.isRunning ? formatDuration(memoizedTimes.currentMs || 0) : null,
  });

  useEffect(() => {
    if (!trackerData.isRunning) {
      setDisplayTime({
        total: trackerData.totalTimeFormatted,
        current: null,
      });
      return;
    }

    const updateTimes = () => {
      const times = calculateTimes(trackerData.tracker);
      setDisplayTime({
        total: formatDuration(times.totalMs),
        current: times.currentMs !== null ? formatDuration(times.currentMs) : null,
      });
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);

    return () => clearInterval(interval);
  }, [trackerData.isRunning, trackerData.tracker]);

  return (
    <tr className={c('meta-row')}>
      <td className={c('meta-value-wrapper')} colSpan={2}>
        <span className={c('time-tracker')}>
          <span className="time-tracker-total">{displayTime.total}</span>
          {displayTime.current && (
            <span className="time-tracker-current">({displayTime.current})</span>
          )}
          <button
            onClick={onToggle}
            className="time-tracker-btn"
            data-running={trackerData.isRunning}
            title={trackerData.isRunning ? 'Stop timer' : 'Start timer'}
          >
            <Icon name={trackerData.isRunning ? 'lucide-square' : 'lucide-play'} />
          </button>
        </span>
      </td>
    </tr>
  );
}

interface TimeTrackerRowProps {
  filePath: string;
}

export function TimeTrackerRow({ filePath }: TimeTrackerRowProps) {
  const { stateManager } = useContext(KanbanContext);

  const [trackers, setTrackers] = useState<TimeTrackerData[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadTrackers = useCallback(async () => {
    const file = stateManager.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      setTrackers([]);
      return;
    }

    try {
      const md = await stateManager.app.vault.read(file);
      const trackerData = getTimeTrackersFromFile(md, filePath);
      trackerData.forEach((t) => (t.filePath = filePath));
      setTrackers(trackerData);
    } catch (e) {
      console.error(
        '[Kanban] Failed to load time trackers:',
        e,
        '- Ensure the linked file exists and is accessible'
      );
      setTrackers([]);
    }
  }, [filePath, stateManager]);

  useEffect(() => {
    loadTrackers();

    const handleFileModify = (file: any) => {
      if (file instanceof TFile && file.path === filePath) {
        trackerCache.delete(filePath);
        loadTrackers();
      }
    };

    const eventRef = (stateManager.app.vault as any).on('modify', handleFileModify);

    return () => {
      (stateManager.app.vault as any).off('modify', eventRef);
    };
  }, [filePath, stateManager, refreshKey, loadTrackers]);

  const handleToggle = useCallback(
    async (tracker: TimeTrackerData) => {
      await toggleTimeTracker(stateManager, tracker.filePath, tracker);
      setRefreshKey((k) => k + 1);
    },
    [stateManager]
  );

  if (trackers.length === 0) {
    return null;
  }

  return (
    <>
      {trackers.map((tracker) => (
        <TimeTrackerDisplay
          key={`${tracker.startIndex}-${tracker.endIndex}`}
          trackerData={tracker}
          onToggle={() => handleToggle(tracker)}
        />
      ))}
    </>
  );
}
