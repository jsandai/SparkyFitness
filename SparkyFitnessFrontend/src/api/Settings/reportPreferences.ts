import { apiCall } from '@/api/api';

export const updateReportDisplayPreference = async (
  viewGroup: string,
  platform: 'desktop' | 'mobile',
  visibleItems: string[]
) => {
  return apiCall(`/preferences/report-display/${viewGroup}/${platform}`, {
    method: 'PUT',
    body: JSON.stringify({ visible_items: visibleItems }),
  });
};

export const resetReportDisplayPreference = async (
  viewGroup: string,
  platform: 'desktop' | 'mobile'
) => {
  return apiCall(`/preferences/report-display/${viewGroup}/${platform}`, {
    method: 'DELETE',
  });
};
