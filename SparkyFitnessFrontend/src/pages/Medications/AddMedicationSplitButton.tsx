import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import AddMedicationDialog from './AddMedicationDialog';

/**
 * "Add medication" with an "Add supplement" alternative behind the chevron.
 *
 * Both open the same dialog — a supplement is a medication subtype, not a separate
 * module — but the supplement route arrives with the toggle already on, so the user
 * doesn't have to know that vitamins live under Medications to find them.
 */
export function AddMedicationSplitButton() {
  const { t } = useTranslation();
  const [supplementOpen, setSupplementOpen] = useState(false);

  return (
    <>
      <div className="flex">
        <AddMedicationDialog
          trigger={
            <Button className="rounded-r-none">
              <Plus className="mr-2 h-4 w-4" />
              {t('medications.cabinet.addMed', 'Add medication')}
            </Button>
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              aria-label={t(
                'medications.cabinet.moreAddOptions',
                'More add options'
              )}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setSupplementOpen(true)}>
              {t('medications.cabinet.addSupplement', 'Add supplement')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AddMedicationDialog
        defaultIsSupplement
        open={supplementOpen}
        onOpenChange={setSupplementOpen}
      />
    </>
  );
}
