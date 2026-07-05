import { getClient } from '../db/poolManager.js';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'pg-f... Remove this comment to see the full error message
import format from 'pg-format';
const TABLE_NAME = 'user_report_display_preferences';

type Platform = 'desktop' | 'mobile';

interface ReportDisplayPreferenceInput {
  view_group: string;
  platform: Platform;
  visible_items: string[];
}

async function getReportDisplayPreferences(userId: string) {
  const query = `SELECT * FROM ${TABLE_NAME} WHERE user_id = $1`;
  const client = await getClient(userId);
  try {
    const { rows } = await client.query(query, [userId]);
    return rows;
  } finally {
    client.release();
  }
}
async function upsertReportDisplayPreference(
  userId: string,
  viewGroup: string,
  platform: Platform,
  visibleItems: string[]
) {
  const query = `
        INSERT INTO ${TABLE_NAME} (user_id, view_group, platform, visible_items)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, view_group, platform)
        DO UPDATE SET visible_items = EXCLUDED.visible_items, updated_at = NOW()
        RETURNING *;
    `;
  const client = await getClient(userId);
  try {
    const { rows } = await client.query(query, [
      userId,
      viewGroup,
      platform,
      JSON.stringify(visibleItems),
    ]);
    return rows[0];
  } finally {
    client.release();
  }
}

async function deleteReportDisplayPreference(
  userId: string,
  viewGroup: string,
  platform: Platform
) {
  const query = `DELETE FROM ${TABLE_NAME} WHERE user_id = $1 AND view_group = $2 AND platform = $3`;
  const client = await getClient(userId);
  try {
    await client.query(query, [userId, viewGroup, platform]);
  } finally {
    client.release();
  }
}

async function createDefaultReportPreferences(
  userId: string,
  defaultPreferences: ReportDisplayPreferenceInput[]
) {
  const values = defaultPreferences.map((pref) => [
    userId,
    pref.view_group,
    pref.platform,
    JSON.stringify(pref.visible_items),
  ]);
  const query = format(
    'INSERT INTO %I (user_id, view_group, platform, visible_items) VALUES %L RETURNING *',
    TABLE_NAME,
    values
  );
  const client = await getClient(userId); // Assuming userId is available in context for this function
  try {
    const { rows } = await client.query(query);
    return rows;
  } finally {
    client.release();
  }
}
export { getReportDisplayPreferences };
export { upsertReportDisplayPreference };
export { deleteReportDisplayPreference };
export { createDefaultReportPreferences };
export default {
  getReportDisplayPreferences,
  upsertReportDisplayPreference,
  deleteReportDisplayPreference,
  createDefaultReportPreferences,
};
