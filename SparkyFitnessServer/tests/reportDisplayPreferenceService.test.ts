import { vi, beforeEach, describe, expect, it } from 'vitest';
import reportDisplayPreferenceService from '../services/reportDisplayPreferenceService.js';
import reportDisplayPreferenceRepository from '../models/reportDisplayPreferenceRepository.js';

vi.mock('../models/reportDisplayPreferenceRepository');

const DEFAULT_MEASUREMENT_ITEMS = [
  'weight',
  'neck',
  'waist',
  'hips',
  'height',
  'body_fat_percentage',
];

describe('reportDisplayPreferenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getReportDisplayPreferences', () => {
    it('returns defaults for every view group/platform combo when the user has no rows', async () => {
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceRepository.getReportDisplayPreferences.mockResolvedValue(
        []
      );

      const result =
        await reportDisplayPreferenceService.getReportDisplayPreferences(
          'user-1'
        );

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            view_group: 'measurement_chart',
            platform: 'desktop',
            visible_items: DEFAULT_MEASUREMENT_ITEMS,
          }),
          expect.objectContaining({
            view_group: 'measurement_chart',
            platform: 'mobile',
            visible_items: DEFAULT_MEASUREMENT_ITEMS,
          }),
        ])
      );
    });

    it('prefers a stored preference over the default for a given platform', async () => {
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceRepository.getReportDisplayPreferences.mockResolvedValue(
        [
          {
            user_id: 'user-1',
            view_group: 'measurement_chart',
            platform: 'desktop',
            visible_items: JSON.stringify(['weight', 'waist']),
          },
        ]
      );

      const result =
        await reportDisplayPreferenceService.getReportDisplayPreferences(
          'user-1'
        );

      const desktop = result.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => p.platform === 'desktop'
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mobile = result.find((p: any) => p.platform === 'mobile');

      expect(desktop.visible_items).toEqual(['weight', 'waist']);
      expect(mobile.visible_items).toEqual(DEFAULT_MEASUREMENT_ITEMS);
    });
  });

  describe('upsertReportDisplayPreference', () => {
    it('delegates to the repository with the provided arguments', async () => {
      const mockPref = {
        user_id: 'user-1',
        view_group: 'measurement_chart',
        platform: 'mobile',
        visible_items: ['weight'],
      };
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceRepository.upsertReportDisplayPreference.mockResolvedValue(
        mockPref
      );

      const result =
        await reportDisplayPreferenceService.upsertReportDisplayPreference(
          'user-1',
          'measurement_chart',
          'mobile',
          ['weight']
        );

      expect(result).toEqual(mockPref);
      expect(
        reportDisplayPreferenceRepository.upsertReportDisplayPreference
      ).toHaveBeenCalledWith('user-1', 'measurement_chart', 'mobile', [
        'weight',
      ]);
    });
  });

  describe('resetReportDisplayPreference', () => {
    it('deletes the persisted row and returns the default preference', async () => {
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceRepository.deleteReportDisplayPreference.mockResolvedValue(
        undefined
      );

      const result =
        await reportDisplayPreferenceService.resetReportDisplayPreference(
          'user-1',
          'measurement_chart',
          'desktop'
        );

      expect(
        reportDisplayPreferenceRepository.deleteReportDisplayPreference
      ).toHaveBeenCalledWith('user-1', 'measurement_chart', 'desktop');
      expect(
        reportDisplayPreferenceRepository.upsertReportDisplayPreference
      ).not.toHaveBeenCalled();
      expect(result).toEqual({
        user_id: 'user-1',
        view_group: 'measurement_chart',
        platform: 'desktop',
        visible_items: DEFAULT_MEASUREMENT_ITEMS,
      });
    });
  });

  describe('createDefaultReportPreferencesForUser', () => {
    it('creates default preferences for both platforms', async () => {
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceRepository.createDefaultReportPreferences.mockResolvedValue(
        []
      );

      await reportDisplayPreferenceService.createDefaultReportPreferencesForUser(
        'user-1'
      );

      expect(
        reportDisplayPreferenceRepository.createDefaultReportPreferences
      ).toHaveBeenCalledWith(
        'user-1',
        expect.arrayContaining([
          expect.objectContaining({
            view_group: 'measurement_chart',
            platform: 'desktop',
            visible_items: DEFAULT_MEASUREMENT_ITEMS,
          }),
          expect.objectContaining({
            view_group: 'measurement_chart',
            platform: 'mobile',
            visible_items: DEFAULT_MEASUREMENT_ITEMS,
          }),
        ])
      );
    });
  });
});
