import { preferencesKeys } from '@/api/keys/settings';
import {
  resetReportDisplayPreference,
  updateReportDisplayPreference,
} from '@/api/Settings/reportPreferences';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export const useUpdateReportPreferenceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      viewGroup,
      platform,
      visibleItems,
    }: {
      viewGroup: string;
      platform: 'desktop' | 'mobile';
      visibleItems: string[];
    }) => updateReportDisplayPreference(viewGroup, platform, visibleItems),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: preferencesKeys.reports() });
    },
  });
};

export const useResetReportPreferenceMutation = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      viewGroup,
      platform,
    }: {
      viewGroup: string;
      platform: 'desktop' | 'mobile';
    }) => resetReportDisplayPreference(viewGroup, platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: preferencesKeys.reports() });
    },
    meta: {
      errorMessage: t('preferences.resetError', 'Failed to reset preferences'),
    },
  });
};
