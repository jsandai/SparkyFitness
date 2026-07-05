import reportDisplayPreferenceRepository from '../models/reportDisplayPreferenceRepository.js';
import { MEASUREMENT_CHART_ITEMS } from '@workspace/shared';

const viewGroups = ['measurement_chart'];
const platforms = ['desktop', 'mobile'] as const;

const defaultVisibleItems: string[] = [...MEASUREMENT_CHART_ITEMS];

const defaultPreferences = viewGroups.flatMap((viewGroup) =>
  platforms.map((platform) => ({
    view_group: viewGroup,
    platform,
    visible_items: defaultVisibleItems,
  }))
);

// The DB driver returns the JSONB column as a parsed array in production, but
// some environments (or tests) hand it back as a raw JSON string. Normalize so
// callers always receive an array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseVisibleItems(row: any) {
  if (row && typeof row.visible_items === 'string') {
    return { ...row, visible_items: JSON.parse(row.visible_items) };
  }
  return row;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getReportDisplayPreferences(userId: any) {
  const userPreferencesRaw =
    await reportDisplayPreferenceRepository.getReportDisplayPreferences(userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userPreferences = userPreferencesRaw.map((p: any) =>
    parseVisibleItems(p)
  );
  // Return a complete set (1 view group x 2 platforms) with fallback to defaults.
  const completePreferences = [];
  for (const group of viewGroups) {
    for (const platform of platforms) {
      const userPref = userPreferences.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => p.view_group === group && p.platform === platform
      );
      if (userPref) {
        completePreferences.push(userPref);
      } else {
        const defaultMatch = defaultPreferences.find(
          (p) => p.view_group === group && p.platform === platform
        );
        const fallback = JSON.parse(JSON.stringify(defaultMatch));
        // The API contract (Swagger schema) marks user_id required, so populate
        // it on default fallbacks that have no persisted row.
        fallback.user_id = userId;
        completePreferences.push(fallback);
      }
    }
  }
  return completePreferences;
}

async function upsertReportDisplayPreference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewGroup: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visibleItems: any
) {
  const result =
    await reportDisplayPreferenceRepository.upsertReportDisplayPreference(
      userId,
      viewGroup,
      platform,
      visibleItems
    );
  return parseVisibleItems(result);
}

async function resetReportDisplayPreference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewGroup: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform: any
) {
  // Reset = drop the persisted row; getReportDisplayPreferences already falls
  // back to defaults when no row exists, so this keeps the table free of
  // redundant default records. Return the synthesized default for the caller.
  await reportDisplayPreferenceRepository.deleteReportDisplayPreference(
    userId,
    viewGroup,
    platform
  );
  const defaultMatch = defaultPreferences.find(
    (p) => p.view_group === viewGroup && p.platform === platform
  );
  return {
    user_id: userId,
    view_group: viewGroup,
    platform,
    visible_items: defaultMatch
      ? defaultMatch.visible_items
      : defaultVisibleItems,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createDefaultReportPreferencesForUser(userId: any) {
  return await reportDisplayPreferenceRepository.createDefaultReportPreferences(
    userId,
    defaultPreferences
  );
}

export { getReportDisplayPreferences };
export { upsertReportDisplayPreference };
export { resetReportDisplayPreference };
export { createDefaultReportPreferencesForUser };
export default {
  getReportDisplayPreferences,
  upsertReportDisplayPreference,
  resetReportDisplayPreference,
  createDefaultReportPreferencesForUser,
};
