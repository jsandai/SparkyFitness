import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Sparkles } from 'lucide-react';
import {
  FOOD_VARIANT_NUTRIENT_FIELDS,
  MICRONUTRIENT_CATALOG,
  MULTIVITAMIN_PANEL_IDS,
  normalizeNutrientName,
} from '@workspace/shared';
import {
  collectClaimedNutrientNames,
  isNutrientOptionAlreadyAdded,
} from './nutrientPickerUtils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CENTRAL_NUTRIENT_CONFIG } from '@/constants/nutrients';
import {
  useCreateCustomNutrientMutation,
  useEnsureCatalogNutrientsMutation,
} from '@/hooks/Foods/useCustomNutrients';
import type { UserCustomNutrient } from '@/types/customNutrient';

type OptionGroup = 'catalog' | 'macro' | 'custom';

interface NutrientOption {
  /** identifies the option within the picker */
  id: string;
  label: string;
  unit: string;
  group: OptionGroup;
  /** the key to store against, for options that don't need seeding first */
  fieldKey?: string;
  /** the canonical catalog id, for options that must be seeded before use */
  catalogId?: string;
}

const GROUP_LABELS: Record<OptionGroup, [string, string]> = {
  catalog: ['medications.cabinet.nutrientGroupCatalog', 'Vitamins & minerals'],
  macro: ['medications.cabinet.nutrientGroupMacro', 'Macronutrients'],
  custom: ['medications.cabinet.nutrientGroupCustom', 'Your custom nutrients'],
};

/**
 * Adds nutrient rows to a supplement's "nutrition per dose" editor.
 *
 * Starts empty and is additive: the user searches the canonical catalog and picks the
 * nutrients that are actually on their label, rather than being handed the 17 fixed food
 * macros (which contain no vitamin D, K, magnesium, zinc or B12 — i.e. none of what a
 * typical supplement supplies). A single-nutrient supplement gets one row; a multivitamin
 * gets its ~20 via the bulk panel button.
 *
 * Picking a catalog nutrient that isn't a built-in column lazily creates the user's
 * `user_custom_nutrients` row server-side, seeded with the catalog's canonical name, unit,
 * aliases and Daily Value.
 */
export function NutrientPicker({
  selected,
  customNutrients,
  onAdd,
}: {
  selected: string[];
  customNutrients?: UserCustomNutrient[];
  onAdd: (keys: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('mg');

  const ensureCatalog = useEnsureCatalogNutrientsMutation();
  const createCustom = useCreateCustomNutrientMutation();
  const isBusy = ensureCatalog.isPending || createCustom.isPending;

  const options = useMemo<NutrientOption[]>(() => {
    // Catalog first — it is the canonical, import-compatible set.
    const catalogOptions: NutrientOption[] = MICRONUTRIENT_CATALOG.map(
      (entry) => ({
        id: `catalog:${entry.id}`,
        label: entry.displayName,
        unit: entry.unit,
        group: 'catalog',
        catalogId: entry.id,
        fieldKey: entry.fixedField,
      })
    );

    // The fixed food macros the catalog doesn't cover (protein, fat, fiber, ...). Still
    // offered — a protein powder or greens blend legitimately supplies them.
    const catalogFixedFields = new Set(
      MICRONUTRIENT_CATALOG.map((entry) => entry.fixedField).filter(Boolean)
    );
    const macroOptions: NutrientOption[] = FOOD_VARIANT_NUTRIENT_FIELDS.filter(
      (field) => !catalogFixedFields.has(field)
    ).map((field) => {
      const cfg = CENTRAL_NUTRIENT_CONFIG[field];
      return {
        id: `macro:${field}`,
        label: cfg ? t(cfg.label, { defaultValue: cfg.defaultLabel }) : field,
        unit: cfg?.unit ?? '',
        group: 'macro',
        fieldKey: field,
      };
    });

    // The user's own free-text nutrients, minus anything the catalog already offers
    // under the same normalized name (otherwise "Vitamin D" would appear twice).
    const catalogNames = new Set(
      MICRONUTRIENT_CATALOG.flatMap((entry) =>
        [entry.displayName, ...entry.aliases].map(normalizeNutrientName)
      )
    );
    const customOptions: NutrientOption[] = (customNutrients ?? [])
      .filter(
        (nutrient) => !catalogNames.has(normalizeNutrientName(nutrient.name))
      )
      .map((nutrient) => ({
        id: `custom:${nutrient.name}`,
        label: nutrient.name,
        unit: nutrient.unit,
        group: 'custom',
        fieldKey: nutrient.name,
      }));

    return [...catalogOptions, ...macroOptions, ...customOptions];
  }, [customNutrients, t]);

  const claimedNames = useMemo(
    () => collectClaimedNutrientNames(selected, customNutrients),
    [selected, customNutrients]
  );

  const isAlreadyAdded = (option: NutrientOption) =>
    isNutrientOptionAlreadyAdded(option, selected, claimedNames);

  const visible = useMemo(() => {
    const query = normalizeNutrientName(search);
    return options.filter((option) => {
      if (isAlreadyAdded(option)) return false;
      if (!query) return true;
      return normalizeNutrientName(option.label).includes(query);
    });
    // isAlreadyAdded is derived from options + claimedNames, both of which are deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, search, claimedNames]);

  const grouped = useMemo(() => {
    const groups: Record<OptionGroup, NutrientOption[]> = {
      catalog: [],
      macro: [],
      custom: [],
    };
    for (const option of visible) groups[option.group].push(option);
    return groups;
  }, [visible]);

  const toggle = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setChecked(new Set());
    setSearch('');
    setNewName('');
    setNewUnit('mg');
  };

  const commit = async (optionIds: Set<string>) => {
    const picked = options.filter((option) => optionIds.has(option.id));
    if (picked.length === 0) return;

    // Catalog picks that aren't built-in columns must exist as custom nutrients before
    // the editor can hold a value for them. The server resolves each id to the name to
    // store against — which may be a spelling the user already had.
    const toSeed = picked
      .filter((option) => option.catalogId && !option.fieldKey)
      .map((option) => option.catalogId as string);

    const keys: string[] = picked
      .filter((option) => option.fieldKey)
      .map((option) => option.fieldKey as string);

    if (toSeed.length > 0) {
      try {
        const result = await ensureCatalog.mutateAsync(toSeed);
        keys.push(
          ...result.resolved.map((entry) => entry.fixedField ?? entry.name)
        );
      } catch {
        // The mutation's meta.errorMessage surfaces the toast. Bail without adding rows
        // or closing, so the user keeps their selection and can retry.
        return;
      }
    }

    onAdd(keys);
    reset();
    setOpen(false);
  };

  const addMultivitaminPanel = () => {
    const ids = new Set(
      MULTIVITAMIN_PANEL_IDS.map((catalogId) => `catalog:${catalogId}`)
    );
    // Don't re-add rows the editor already has.
    const addable = new Set(
      options
        .filter((option) => ids.has(option.id) && !isAlreadyAdded(option))
        .map((option) => option.id)
    );
    void commit(addable);
  };

  const trimmedNewName = newName.trim();
  const newNameCollides =
    trimmedNewName.length > 0 &&
    options.some(
      (option) =>
        normalizeNutrientName(option.label) ===
        normalizeNutrientName(trimmedNewName)
    );

  const createFreeText = async () => {
    if (!trimmedNewName || newNameCollides) return;
    try {
      await createCustom.mutateAsync({
        name: trimmedNewName,
        unit: newUnit.trim() || 'mg',
      });
    } catch {
      // The mutation's meta.errorMessage surfaces the toast. Keep the typed name so the
      // user can retry rather than losing it.
      return;
    }
    onAdd([trimmedNewName]);
    reset();
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            {t('medications.cabinet.addNutrient', 'Add nutrient')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(
                'medications.cabinet.searchNutrients',
                'Search nutrients…'
              )}
              className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <ScrollArea className="max-h-72 overflow-y-auto">
            <div className="p-1">
              {visible.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t(
                    'medications.cabinet.noNutrientMatches',
                    'No matches. Create it below.'
                  )}
                </p>
              )}
              {(Object.keys(grouped) as OptionGroup[]).map((group) => {
                const groupOptions = grouped[group];
                if (groupOptions.length === 0) return null;
                const [labelKey, labelDefault] = GROUP_LABELS[group];
                return (
                  <div key={group} className="mb-1">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(labelKey, labelDefault)}
                    </p>
                    {groupOptions.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked.has(option.id)}
                          onCheckedChange={() => toggle(option.id)}
                        />
                        <span className="flex-1">{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.unit}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <div className="space-y-2 border-t p-3">
            <Label className="text-xs text-muted-foreground">
              {t(
                'medications.cabinet.createNutrient',
                'Not listed? Create your own'
              )}
            </Label>
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t(
                  'medications.cabinet.nutrientNamePlaceholder',
                  'e.g. Ashwagandha'
                )}
                className="h-8"
              />
              <Input
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                className="h-8 w-16"
                aria-label={t('medications.cabinet.nutrientUnit', 'Unit')}
              />
            </div>
            {newNameCollides && (
              <p className="text-xs text-destructive">
                {t(
                  'medications.cabinet.nutrientExists',
                  'That nutrient already exists — pick it from the list.'
                )}
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={!trimmedNewName || newNameCollides || isBusy}
              onClick={() => void createFreeText()}
            >
              {t('medications.cabinet.createAndAdd', 'Create & add')}
            </Button>
          </div>

          <div className="border-t p-3">
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={checked.size === 0 || isBusy}
              onClick={() => void commit(checked)}
            >
              {checked.size > 0
                ? t('medications.cabinet.addSelectedCount', {
                    defaultValue: 'Add {{count}} nutrient',
                    defaultValue_other: 'Add {{count}} nutrients',
                    count: checked.size,
                  })
                : t('medications.cabinet.addSelected', 'Add selected')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isBusy}
        onClick={addMultivitaminPanel}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        {t('medications.cabinet.multivitaminPanel', 'Multivitamin panel')}
      </Button>
    </div>
  );
}
