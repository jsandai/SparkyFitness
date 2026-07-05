import type React from 'react';
import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePreferences } from '@/contexts/PreferencesContext';
import { toast } from '@/hooks/use-toast';
import {
  useResetReportPreferenceMutation,
  useUpdateReportPreferenceMutation,
} from '@/hooks/Settings/useReportPreferences';
import { getErrorMessage } from '@/utils/api';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MEASUREMENT_CHART_ITEMS } from '@workspace/shared';

const measurementItems: string[] = [...MEASUREMENT_CHART_ITEMS];

const viewGroups = [{ id: 'measurement_chart', name: 'Measurement Chart' }];

interface ReportPreference {
  view_group: string;
  platform: 'desktop' | 'mobile';
  visible_items: string[];
}

function buildOrderedList(
  visibleItems: string[],
  allItems: string[]
): string[] {
  const visibleSet = new Set(visibleItems);
  const rest = allItems.filter((n) => !visibleSet.has(n));
  return [...visibleItems, ...rest];
}

interface SortableItemRowProps {
  item: string;
  isVisible: boolean;
  onToggle: (item: string, checked: boolean) => void;
}

function SortableItemRow({ item, isVisible, onToggle }: SortableItemRowProps) {
  const { t } = useTranslation();
  const uniqueId = useId();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getItemLabel = (key: string) =>
    t(`settings.reportsDisplay.items.${key}`, {
      defaultValue: key.replace(/_/g, ' '),
    });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity touch-none"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${item}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        id={uniqueId}
        checked={isVisible}
        onCheckedChange={(checked) => onToggle(item, !!checked)}
      />
      <Label
        htmlFor={uniqueId}
        className="capitalize cursor-pointer select-none"
      >
        {getItemLabel(item)}
      </Label>
    </div>
  );
}

function buildInitialOrder(
  preferences: ReportPreference[],
  allItems: string[]
) {
  const initialOrder: Record<string, Record<string, string[]>> = {};
  for (const group of viewGroups) {
    const groupOrders: Record<'desktop' | 'mobile', string[]> = {
      desktop: [],
      mobile: [],
    };

    for (const platform of ['desktop', 'mobile'] as const) {
      const pref = preferences.find(
        (p) => p.view_group === group.id && p.platform === platform
      );
      groupOrders[platform] = buildOrderedList(
        pref?.visible_items ?? [],
        allItems
      );
    }

    initialOrder[group.id] = groupOrders;
  }
  return initialOrder;
}

interface ReportsDisplaySettingsInnerProps {
  initialPreferences: ReportPreference[];
  updatePreference: (variables: {
    viewGroup: string;
    platform: 'desktop' | 'mobile';
    visibleItems: string[];
  }) => Promise<unknown>;
  resetPreference: (variables: {
    viewGroup: string;
    platform: 'desktop' | 'mobile';
  }) => Promise<{ visible_items?: string[] }>;
  loadReportDisplayPreferences: () => void;
}

const ReportsDisplaySettingsInner: React.FC<
  ReportsDisplaySettingsInnerProps
> = ({
  initialPreferences,
  updatePreference,
  resetPreference,
  loadReportDisplayPreferences,
}) => {
  const allItems = measurementItems;

  const [preferences, setPreferences] =
    useState<ReportPreference[]>(initialPreferences);
  const [itemOrder, setItemOrder] = useState<
    Record<string, Record<string, string[]>>
  >(() => buildInitialOrder(initialPreferences, allItems));
  const [syncState, setSyncState] = useState<Record<string, boolean>>({});
  const [activePlatformTab, setActivePlatformTab] = useState<
    'desktop' | 'mobile'
  >('desktop');
  const [activeViewGroupTab, setActiveViewGroupTab] = useState<string>(
    viewGroups[0]!.id
  );
  const isSavingRef = useRef(false);

  const getVisibleItems = useCallback(
    (viewGroup: string, platform: string): string[] => {
      const pref = preferences.find(
        (p) => p.view_group === viewGroup && p.platform === platform
      );
      return pref?.visible_items ?? [];
    },
    [preferences]
  );

  const updatePreferences = useCallback(
    (viewGroup: string, platform: 'desktop' | 'mobile', newItems: string[]) => {
      setPreferences((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (p) => p.view_group === viewGroup && p.platform === platform
        );
        if (idx > -1) {
          next[idx] = { ...next[idx]!, visible_items: newItems };
        } else {
          next.push({
            view_group: viewGroup,
            platform,
            visible_items: newItems,
          });
        }
        return next;
      });
    },
    []
  );

  const savePreferences = useCallback(async () => {
    // Guard against overlapping saves: if a request is already in flight, skip.
    // The debounced effect re-runs once initialPreferences refreshes, so any
    // edits made mid-flight are picked up on the next tick.
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const changedPreferences = preferences.filter((p) => {
        const originalPref = initialPreferences.find(
          (op) => op.view_group === p.view_group && op.platform === p.platform
        );
        return (
          !originalPref ||
          JSON.stringify(p.visible_items) !==
            JSON.stringify(originalPref.visible_items)
        );
      });

      for (const pref of changedPreferences) {
        try {
          await updatePreference({
            viewGroup: pref.view_group,
            platform: pref.platform,
            visibleItems: pref.visible_items,
          });
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          toast({
            title: 'Error',
            description: `Failed to save ${pref.view_group} (${pref.platform}) preferences: ${message}`,
            variant: 'destructive',
          });
        }
      }
      loadReportDisplayPreferences();
    } finally {
      isSavingRef.current = false;
    }
  }, [
    initialPreferences,
    preferences,
    loadReportDisplayPreferences,
    updatePreference,
  ]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (JSON.stringify(preferences) !== JSON.stringify(initialPreferences)) {
        savePreferences();
      }
    }, 1000);
    return () => clearTimeout(handler);
  }, [preferences, initialPreferences, savePreferences]);

  const handleCheckboxChange = (
    viewGroup: string,
    platform: 'desktop' | 'mobile',
    item: string,
    checked: boolean
  ) => {
    const isSynced = syncState[viewGroup] || false;
    const platformsToUpdate: ('desktop' | 'mobile')[] = isSynced
      ? ['desktop', 'mobile']
      : [platform];

    platformsToUpdate.forEach((pform) => {
      const order =
        itemOrder[viewGroup]?.[pform] ??
        buildOrderedList(getVisibleItems(viewGroup, pform), allItems);
      const currentVisible = getVisibleItems(viewGroup, pform);
      const newVisible = checked
        ? order.filter((n) => n === item || currentVisible.includes(n))
        : currentVisible.filter((n) => n !== item);
      updatePreferences(viewGroup, pform, newVisible);
    });
  };

  const handleDragEnd = (
    event: DragEndEvent,
    viewGroup: string,
    platform: 'desktop' | 'mobile'
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const isSynced = syncState[viewGroup] || false;
    const platformsToUpdate: ('desktop' | 'mobile')[] = isSynced
      ? ['desktop', 'mobile']
      : [platform];

    platformsToUpdate.forEach((pform) => {
      const currentOrder =
        itemOrder[viewGroup]?.[pform] ??
        buildOrderedList(getVisibleItems(viewGroup, pform), allItems);
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);

      setItemOrder((prev) => ({
        ...prev,
        [viewGroup]: { ...(prev[viewGroup] ?? {}), [pform]: newOrder },
      }));

      const currentVisible = new Set(getVisibleItems(viewGroup, pform));
      const newVisible = newOrder.filter((n) => currentVisible.has(n));
      updatePreferences(viewGroup, pform, newVisible);
    });
  };

  const handleSelectAll = (
    viewGroup: string,
    platform: 'desktop' | 'mobile'
  ) => {
    const isSynced = syncState[viewGroup] || false;
    const platformsToUpdate: ('desktop' | 'mobile')[] = isSynced
      ? ['desktop', 'mobile']
      : [platform];
    platformsToUpdate.forEach((pform) => {
      const order =
        itemOrder[viewGroup]?.[pform] ??
        buildOrderedList(getVisibleItems(viewGroup, pform), allItems);
      updatePreferences(viewGroup, pform, order);
    });
  };

  const handleClearAll = (
    viewGroup: string,
    platform: 'desktop' | 'mobile'
  ) => {
    const isSynced = syncState[viewGroup] || false;
    const platformsToUpdate: ('desktop' | 'mobile')[] = isSynced
      ? ['desktop', 'mobile']
      : [platform];
    platformsToUpdate.forEach((pform) =>
      updatePreferences(viewGroup, pform, [])
    );
  };

  const handleReset = async (
    viewGroup: string,
    platform: 'desktop' | 'mobile'
  ) => {
    const isSynced = syncState[viewGroup] || false;
    const platformsToReset: ('desktop' | 'mobile')[] = isSynced
      ? ['desktop', 'mobile']
      : [platform];

    for (const pform of platformsToReset) {
      try {
        const defaultPreference = await resetPreference({
          viewGroup,
          platform: pform,
        });
        if (defaultPreference?.visible_items) {
          updatePreferences(viewGroup, pform, defaultPreference.visible_items);
          setItemOrder((prev) => ({
            ...prev,
            [viewGroup]: {
              ...(prev[viewGroup] ?? {}),
              [pform]: buildOrderedList(
                defaultPreference.visible_items ?? [],
                allItems
              ),
            },
          }));
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        toast({
          title: 'Error',
          description: `Failed to reset ${viewGroup} (${pform}) preferences: ${message}`,
          variant: 'destructive',
        });
      }
    }
    loadReportDisplayPreferences();
    toast({
      title: 'Success',
      description: `Preferences for ${viewGroup} (${platformsToReset.join(' & ')}) have been reset to default.`,
    });
  };

  const handleSyncToggle = (
    viewGroup: string,
    platform: 'desktop' | 'mobile'
  ) => {
    const newSyncState = !syncState[viewGroup];
    setSyncState((prev) => ({ ...prev, [viewGroup]: newSyncState }));

    if (newSyncState) {
      const sourcePref = preferences.find(
        (p) => p.view_group === viewGroup && p.platform === platform
      );
      const targetPlatform = platform === 'desktop' ? 'mobile' : 'desktop';
      if (sourcePref) {
        updatePreferences(viewGroup, targetPlatform, sourcePref.visible_items);
      }
      const sourceOrder = itemOrder[viewGroup]?.[platform];
      if (sourceOrder) {
        setItemOrder((prev) => ({
          ...prev,
          [viewGroup]: {
            ...(prev[viewGroup] ?? {}),
            [targetPlatform]: sourceOrder,
          },
        }));
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Tabs
        value={activePlatformTab}
        onValueChange={(value) =>
          setActivePlatformTab(value as 'desktop' | 'mobile')
        }
      >
        <TabsList className="h-10">
          <TabsTrigger value="desktop">
            {t('settings.reportsDisplay.desktop', 'Desktop')}
          </TabsTrigger>
          <TabsTrigger value="mobile">
            {t('settings.reportsDisplay.mobile', 'Mobile')}
          </TabsTrigger>
        </TabsList>

        {(['desktop', 'mobile'] as const).map((platform) => (
          <TabsContent key={platform} value={platform}>
            <Tabs
              value={activeViewGroupTab}
              onValueChange={setActiveViewGroupTab}
            >
              <TabsList className="h-10">
                {viewGroups.map((group) => (
                  <TabsTrigger key={group.id} value={group.id}>
                    {group.name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {viewGroups.map((group) => {
                const visibleSet = new Set(getVisibleItems(group.id, platform));
                const orderedList =
                  itemOrder[group.id]?.[platform] ??
                  buildOrderedList(
                    getVisibleItems(group.id, platform),
                    allItems
                  );

                return (
                  <TabsContent key={group.id} value={group.id}>
                    <p className="text-sm text-muted-foreground mb-1">
                      {t(
                        'settings.reportsDisplay.groupDescription',
                        'Controls which measurement charts are shown on the Reports page.'
                      )}
                    </p>

                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(e) => handleDragEnd(e, group.id, platform)}
                    >
                      <SortableContext
                        items={orderedList}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-0.5">
                          {orderedList.map((item) => (
                            <SortableItemRow
                              key={item}
                              item={item}
                              isVisible={visibleSet.has(item)}
                              onToggle={(n, checked) =>
                                handleCheckboxChange(
                                  group.id,
                                  platform,
                                  n,
                                  checked
                                )
                              }
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>

                    <div className="flex items-center gap-4 mt-6 pt-4 border-t flex-wrap">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`sync-${group.id}-${platform}`}
                          checked={syncState[group.id] || false}
                          onCheckedChange={() =>
                            handleSyncToggle(group.id, platform)
                          }
                        />
                        <Label
                          className="cursor-pointer"
                          htmlFor={`sync-${group.id}-${platform}`}
                        >
                          {platform === 'desktop'
                            ? t(
                                'settings.reportsDisplay.syncWithMobile',
                                'Sync with Mobile'
                              )
                            : t(
                                'settings.reportsDisplay.syncWithDesktop',
                                'Sync with Desktop'
                              )}
                        </Label>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => handleSelectAll(group.id, platform)}
                      >
                        {t('settings.reportsDisplay.selectAll', 'Select All')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleClearAll(group.id, platform)}
                      >
                        {t('settings.reportsDisplay.clearAll', 'Clear All')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleReset(group.id, platform)}
                      >
                        {t(
                          'settings.reportsDisplay.resetToDefault',
                          'Reset to Default'
                        )}
                      </Button>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

const ReportsDisplaySettings = () => {
  const { reportDisplayPreferences, loadReportDisplayPreferences } =
    usePreferences();
  const { mutateAsync: updatePreference } = useUpdateReportPreferenceMutation();
  const { mutateAsync: resetPreference } = useResetReportPreferenceMutation();

  const isDataLoaded = reportDisplayPreferences.length > 0;

  if (!isDataLoaded) {
    return null;
  }

  const componentKey =
    reportDisplayPreferences.length > 0 ? 'loaded' : 'default';

  return (
    <ReportsDisplaySettingsInner
      key={componentKey}
      initialPreferences={reportDisplayPreferences}
      updatePreference={updatePreference}
      resetPreference={resetPreference}
      loadReportDisplayPreferences={loadReportDisplayPreferences}
    />
  );
};

export default ReportsDisplaySettings;
