import { useRef, useState } from 'react';
import { instantHourMinute, dayToUtcRange } from '@workspace/shared';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Droplet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Star,
  Plus,
  Minus,
  Trash2,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/contexts/PreferencesContext';
import { convertMlToSelectedUnit } from '@/utils/nutritionCalculations';
import { useWaterContainer } from '@/contexts/WaterContainerContext';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import {
  useWaterGoalQuery,
  useWaterIntakeQuery,
  useUpdateWaterIntakeMutation,
  useWaterIntakeLogQuery,
  useDeleteWaterIntakeLogMutation,
  useUpdateWaterIntakeLogTimeMutation,
} from '@/hooks/Diary/useWaterIntake';

interface WaterIntakeProps {
  selectedDate: string;
}

interface DrinkTimeEditorProps {
  // 24-hour "HH:MM" seed for both the text field and the native picker.
  initialValue: string;
  label: string;
  onCommit: (rawValue: string) => void;
  onCancel: () => void;
}

// Inline time editor for a logged drink. The text field accepts free-form
// entry (24h "2210"/"22:10" or 12h "230pm"); the clock button opens the
// browser's native time picker for pointer-first users. Both routes funnel
// through onCommit, which normalizes before saving.
const DrinkTimeEditor = ({
  initialValue,
  label,
  onCommit,
  onCancel,
}: DrinkTimeEditorProps) => {
  const pickerRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    try {
      // showPicker() is the reliable way to open the native time UI on demand.
      (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // Older browsers: fall back to focusing the native input.
      el.focus();
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <input
        type="text"
        inputMode="numeric"
        maxLength={8}
        placeholder="HH:MM"
        aria-label={label}
        className="text-xs tabular-nums bg-white dark:bg-slate-700 border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-[72px]"
        defaultValue={initialValue}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          // Ignore blurs caused by interacting with our own picker/button,
          // so opening the native picker doesn't prematurely commit + unmount.
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.parentElement?.contains(next)) return;
          onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onCommit((e.target as HTMLInputElement).value);
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        autoFocus
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 shrink-0 p-0.5"
        // Prevent the text field from blurring (and committing) before the
        // picker opens.
        onMouseDown={(e) => e.preventDefault()}
        onClick={openPicker}
      >
        <Clock className="h-3.5 w-3.5" />
      </button>
      <input
        ref={pickerRef}
        type="time"
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        defaultValue={initialValue}
        onChange={(e) => {
          if (e.target.value) onCommit(e.target.value);
        }}
      />
    </div>
  );
};

const WaterIntake = ({ selectedDate }: WaterIntakeProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeUserId } = useActiveUser(); // Get activeUserId
  const { activeContainer, containers } = useWaterContainer(); // Use activeContainer and containers from context
  const { water_display_unit } = usePreferences();
  const userId = activeUserId || user?.id;
  const { data: waterGoalMl = 1920 } = useWaterGoalQuery(selectedDate, userId);
  const { data: waterMl = 0 } = useWaterIntakeQuery(selectedDate, userId);
  const { mutate: updateWaterIntake, isPending: loading } =
    useUpdateWaterIntakeMutation();
  const { data: logEntries = [] } = useWaterIntakeLogQuery(
    selectedDate,
    userId
  );
  const { mutate: deleteLogEntry, isPending: deleting } =
    useDeleteWaterIntakeLogMutation();
  const { mutate: updateLogTime } = useUpdateWaterIntakeLogTimeMutation();

  // Local state for the selected container in the diary
  const [selectedContainerId, setSelectedContainerId] = useState<number | null>(
    () => activeContainer?.id ?? null
  );

  // Local state for log panel visibility
  const [showLog, setShowLog] = useState(false);

  // State for editing time on a log entry
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);

  // Derived selected container
  const currentContainer =
    containers.find((c) => c.id === selectedContainerId) || activeContainer;

  const cycleContainer = (direction: 'next' | 'prev') => {
    if (containers.length <= 1) return;

    const currentIndex = containers.findIndex(
      (c) => c.id === currentContainer?.id
    );
    let nextIndex;

    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % containers.length;
    } else {
      nextIndex = (currentIndex - 1 + containers.length) % containers.length;
    }

    const nextContainer = containers[nextIndex];
    if (nextContainer) {
      setSelectedContainerId(nextContainer.id);
    }
  };
  const saveWaterIntake = (
    changeDrinks: number,
    containerId: number | null
  ) => {
    if (!userId) {
      return;
    }
    updateWaterIntake({
      user_id: userId,
      entry_date: selectedDate,
      change_drinks: changeDrinks,
      container_id: containerId,
    });
  };

  const adjustWater = (changeDrinks: number) => {
    saveWaterIntake(changeDrinks, currentContainer?.id || null);
  };

  const getVolumeDisplay = () => {
    if (currentContainer) {
      const servings = Math.max(
        1,
        currentContainer.servings_per_container || 1
      );
      const volumePerDrink = currentContainer.volume / servings;
      const displayVolume = convertMlToSelectedUnit(
        volumePerDrink,
        currentContainer.unit
      ).toFixed(currentContainer.unit === 'ml' ? 0 : 2);

      return t('foodDiary.waterIntake.perDrink', {
        volume: displayVolume,
        unit: currentContainer.unit,
      });
    }

    const displayVolume = convertMlToSelectedUnit(
      250,
      water_display_unit
    ).toFixed(water_display_unit === 'ml' ? 0 : 2);
    return t('foodDiary.waterIntake.defaultPerDrink', {
      volume: displayVolume,
      unit: water_display_unit,
    });
  };

  const { timezone } = usePreferences();

  const formatLogTime = (timestamp: string) => {
    try {
      const { hour, minute } = instantHourMinute(timestamp, timezone);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch {
      return '--:--';
    }
  };

  const getTimeInputValue = (timestamp: string) => {
    try {
      const { hour, minute } = instantHourMinute(timestamp, timezone);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch {
      return '12:00';
    }
  };

  // Normalize free-form time entry into a 24-hour "HH:MM" string.
  // Un-suffixed input is treated as 24-hour: "2210", "22:10", "930", "9:5",
  // "22" (-> 22:00). An explicit AM/PM suffix switches to 12-hour parsing:
  // "230pm" -> 22:30, "12:15am" -> 00:15, "12pm" -> 12:00. Returns null when
  // the value can't be parsed into a valid time so the caller can reject it
  // instead of committing a bad instant.
  const normalizeTimeInput = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // Parse a trailing am/pm token BEFORE stripping non-digits, so a meridiem
    // is never silently discarded. Accepts "pm", "p", "p.m.", " PM", etc.
    const meridiemMatch = trimmed.match(/([ap])\.?\s*m?\.?\s*$/i);
    let meridiem: 'a' | 'p' | null = null;
    let timePart = trimmed;
    if (meridiemMatch && meridiemMatch.index !== undefined) {
      meridiem = (meridiemMatch[1] || '').toLowerCase() === 'p' ? 'p' : 'a';
      timePart = trimmed.slice(0, meridiemMatch.index).trim();
    }
    if (!timePart) return null;

    let hours: number;
    let minutes: number;

    if (timePart.includes(':')) {
      const [h, m] = timePart.split(':');
      hours = parseInt(h || '', 10);
      minutes = parseInt(m || '0', 10);
    } else {
      const digits = timePart.replace(/\D/g, '');
      if (!digits) return null;
      if (digits.length <= 2) {
        hours = parseInt(digits, 10);
        minutes = 0;
      } else {
        // last two digits are minutes, everything before is the hour
        hours = parseInt(digits.slice(0, -2), 10);
        minutes = parseInt(digits.slice(-2), 10);
      }
    }

    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (minutes < 0 || minutes > 59) return null;

    if (meridiem) {
      // 12-hour: valid clock hours are 1..12; 12am -> 0, 12pm -> 12.
      if (hours < 1 || hours > 12) return null;
      if (meridiem === 'p' && hours < 12) hours += 12;
      if (meridiem === 'a' && hours === 12) hours = 0;
    } else if (hours < 0 || hours > 23) {
      return null;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const commitTimeChange = (
    entryId: string,
    entryDate: string,
    rawValue: string
  ) => {
    const normalized = normalizeTimeInput(rawValue);
    if (!normalized) {
      // Unparseable entry — cancel the edit and keep the original time.
      setEditingTimeId(null);
      return;
    }
    handleTimeChange(entryId, entryDate, normalized);
  };

  const handleTimeChange = (
    entryId: string,
    entryDate: string,
    newTime: string
  ) => {
    try {
      // entryDate is a Postgres DATE column serialized as UTC midnight
      // (e.g. "2026-05-14T00:00:00.000Z"). Extract the YYYY-MM-DD substring
      // directly — do NOT use instantToDay, which would roll back to the
      // previous day for users west of UTC.
      const datePart = entryDate.substring(0, 10);
      const timeParts = newTime.split(':');
      const hours = parseInt(timeParts[0] || '0', 10);
      const minutes = parseInt(timeParts[1] || '0', 10);

      // Build a UTC instant from the user's local day + time using dayToUtcRange
      // dayToUtcRange gives midnight UTC for this day in the user's timezone
      const { start } = dayToUtcRange(datePart, timezone);
      const loggedAt = new Date(
        start.getTime() + hours * 3600000 + minutes * 60000
      ).toISOString();

      updateLogTime({ logId: entryId, loggedAt });
      setEditingTimeId(null);
    } catch (e) {
      console.error('Error formatting time:', e);
      setEditingTimeId(null);
    }
  };

  if (!user) {
    return null;
  }

  const fillPercentage = Math.min((waterMl / waterGoalMl) * 100, 100);
  const displayUnit = currentContainer?.unit || water_display_unit;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base dark:text-slate-300">
          <Droplet className="w-4 h-4 mr-2" />
          {t('foodDiary.waterIntake.title', 'Water Intake')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between p-3 dark:text-slate-300">
        {/* Water count display */}
        <div className="text-center mb-3">
          <div className="text-xl font-bold">
            {convertMlToSelectedUnit(
              waterMl,
              currentContainer?.unit || water_display_unit
            ).toFixed(currentContainer?.unit === 'ml' ? 0 : 2)}{' '}
            /{' '}
            {convertMlToSelectedUnit(
              waterGoalMl,
              currentContainer?.unit || water_display_unit
            ).toFixed(currentContainer?.unit === 'ml' ? 0 : 2)}
          </div>
          <div className="text-gray-500 text-xs">
            {currentContainer?.unit || water_display_unit}
          </div>
        </div>

        {/* Water Bottle Visualization - takes up most space */}
        <div className="flex-1 flex flex-col items-center justify-center mb-3">
          <div className="relative flex flex-col items-center">
            {/* Bottle Cap */}
            <div className="w-5 h-1.5 bg-blue-400 rounded-t-sm mb-0.5"></div>

            {/* Bottle Neck */}
            <div className="w-7 h-5 bg-gray-100 dark:bg-slate-200 border-2 border-blue-400 rounded-sm mb-0.5"></div>

            {/* Main Bottle Body */}
            <div className="relative w-16 h-32 border-3 dark:bg-slate-300 border-blue-400 rounded-xl bg-gray-50 overflow-hidden">
              {/* Water Fill */}
              <div
                className="absolute bottom-0 w-full bg-gradient-to-t from-blue-500 via-blue-400 to-blue-300 transition-all duration-700 ease-out rounded-b-xl"
                style={{ height: `${fillPercentage}%` }}
              >
                {/* Water Surface Ripple Effect */}
                {fillPercentage > 0 && (
                  <div className="absolute top-0 w-full h-0.5 bg-blue-200 opacity-60 animate-pulse"></div>
                )}
              </div>

              {/* Bottle Highlight */}
              <div className="absolute top-3 left-2 w-2.5 h-10 bg-white opacity-30 rounded-full"></div>

              {/* Water Level Lines */}
              <div className="absolute inset-0 flex flex-col justify-between p-0.5">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="w-full h-px bg-blue-200 opacity-40"
                  ></div>
                ))}
              </div>
            </div>

            {/* Progress Percentage */}
            <div className="text-xs text-gray-600 mt-1.5 font-medium">
              {Math.round(fillPercentage)}%
            </div>
          </div>
        </div>

        {/* Intuitive Water Controls: [ - ] VOLUME [ + ] */}
        <div className="flex items-center justify-center space-x-3">
          <Button
            variant="outline"
            onClick={() => adjustWater(-1)}
            disabled={waterMl === 0 || loading}
            size="icon"
            className="h-8 w-8 rounded-full"
          >
            <Minus className="h-4 w-4" />
          </Button>

          <div className="text-center min-w-[70px]">
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {getVolumeDisplay()}
            </div>
          </div>

          <Button
            onClick={() => adjustWater(1)}
            disabled={loading}
            size="icon"
            className="h-8 w-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Container Toggle (Source) */}
        <div className="flex items-center justify-center mt-3 pt-2 border-t border-gray-100 dark:border-slate-800 space-x-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => cycleContainer('prev')}
            disabled={containers.length <= 1}
            className="h-6 w-6 text-gray-400 hover:text-gray-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center justify-center space-x-1 px-1">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate max-w-[110px]">
              {currentContainer?.name ||
                t('foodDiary.waterIntake.defaultContainer', 'Container')}
            </div>
            {currentContainer?.is_primary && (
              <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => cycleContainer('next')}
            disabled={containers.length <= 1}
            className="h-6 w-6 text-gray-400 hover:text-gray-600"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Drink History Log */}
        {logEntries.length > 0 && (
          <div className="mt-3 pt-2 border-t border-gray-100 dark:border-slate-800">
            <button
              onClick={() => setShowLog(!showLog)}
              className="flex items-center justify-between w-full text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <span>
                {t('foodDiary.waterIntake.logTitle', "Today's drinks")} (
                {logEntries.length})
              </span>
              {showLog ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {showLog && (
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {logEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-1 px-1.5 rounded text-xs bg-gray-50 dark:bg-slate-800/50 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {editingTimeId === entry.id ? (
                        <DrinkTimeEditor
                          label={t(
                            'foodDiary.waterIntake.editTime',
                            'Click to change time'
                          )}
                          initialValue={getTimeInputValue(
                            entry.logged_at || entry.created_at
                          )}
                          onCommit={(rawValue) =>
                            commitTimeChange(
                              entry.id,
                              entry.entry_date,
                              rawValue
                            )
                          }
                          onCancel={() => setEditingTimeId(null)}
                        />
                      ) : (
                        <button
                          onClick={() => setEditingTimeId(entry.id)}
                          className="text-gray-400 dark:text-gray-500 tabular-nums shrink-0 hover:text-blue-500 dark:hover:text-blue-400 hover:underline cursor-pointer transition-colors"
                          title={t(
                            'foodDiary.waterIntake.editTime',
                            'Click to change time'
                          )}
                        >
                          {formatLogTime(entry.logged_at || entry.created_at)}
                        </button>
                      )}
                      <span className="text-gray-600 dark:text-gray-300 truncate">
                        {entry.container_name ||
                          t(
                            'foodDiary.waterIntake.defaultContainer',
                            'Container'
                          )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {convertMlToSelectedUnit(
                          Number(entry.water_ml),
                          displayUnit
                        ).toFixed(displayUnit === 'ml' ? 0 : 1)}{' '}
                        {displayUnit}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={() => deleteLogEntry(entry.id)}
                        disabled={deleting}
                        title={t(
                          'foodDiary.waterIntake.deleteEntry',
                          'Delete this drink'
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WaterIntake;
