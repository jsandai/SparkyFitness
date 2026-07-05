import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'supertest'
import request from 'supertest';
import express from 'express';
import reportDisplayPreferenceService from '../services/reportDisplayPreferenceService.js';
import reportDisplayPreferenceRoutes from '../routes/reportDisplayPreferenceRoutes.js';

vi.mock('../services/reportDisplayPreferenceService.js', () => ({
  default: {
    getReportDisplayPreferences: vi.fn(),
    upsertReportDisplayPreference: vi.fn(),
    resetReportDisplayPreference: vi.fn(),
  },
}));

vi.mock('../middleware/authMiddleware.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.authenticatedUserId = 'test-user-id';
    next();
  },
}));

vi.mock('../config/logging.js', () => ({
  log: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/preferences/report-display', reportDisplayPreferenceRoutes);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(err.status || 500).json({ error: err.message });
});

describe('Report Display Preference Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/preferences/report-display', () => {
    it('should return all report display preferences for the user', async () => {
      const preferences = [
        {
          user_id: 'test-user-id',
          view_group: 'measurement_chart',
          platform: 'desktop',
          visible_items: ['weight', 'waist'],
        },
      ];
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceService.getReportDisplayPreferences.mockResolvedValue(
        preferences
      );

      const res = await request(app).get('/api/preferences/report-display');

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual(preferences);
      expect(
        reportDisplayPreferenceService.getReportDisplayPreferences
      ).toHaveBeenCalledWith('test-user-id');
    });

    it('should return 500 on unexpected service error', async () => {
      // @ts-expect-error TS(2339): Property 'mockRejectedValue' does not exist on type
      reportDisplayPreferenceService.getReportDisplayPreferences.mockRejectedValue(
        new Error('DB error')
      );

      const res = await request(app).get('/api/preferences/report-display');

      expect(res.statusCode).toEqual(500);
    });
  });

  describe('PUT /api/preferences/report-display/:viewGroup/:platform', () => {
    it('should upsert a report display preference', async () => {
      const updated = {
        user_id: 'test-user-id',
        view_group: 'measurement_chart',
        platform: 'desktop',
        visible_items: ['weight'],
      };
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceService.upsertReportDisplayPreference.mockResolvedValue(
        updated
      );

      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/desktop')
        .send({ visible_items: ['weight'] });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual(updated);
      expect(
        reportDisplayPreferenceService.upsertReportDisplayPreference
      ).toHaveBeenCalledWith('test-user-id', 'measurement_chart', 'desktop', [
        'weight',
      ]);
    });

    it('should return 400 when visible_items is missing', async () => {
      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/desktop')
        .send({});

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request body');
      expect(
        reportDisplayPreferenceService.upsertReportDisplayPreference
      ).not.toHaveBeenCalled();
    });

    it('should return 400 when visible_items is not an array of strings', async () => {
      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/desktop')
        .send({ visible_items: [123] });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request body');
    });

    it('should return 400 when visible_items contains an unknown item key', async () => {
      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/desktop')
        .send({ visible_items: ['weight', 'not_a_real_metric'] });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request body');
      expect(
        reportDisplayPreferenceService.upsertReportDisplayPreference
      ).not.toHaveBeenCalled();
    });

    it('should return 400 for an invalid platform param', async () => {
      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/tablet')
        .send({ visible_items: ['weight'] });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request parameters');
      expect(
        reportDisplayPreferenceService.upsertReportDisplayPreference
      ).not.toHaveBeenCalled();
    });

    it('should return 400 for an unknown viewGroup param', async () => {
      const res = await request(app)
        .put('/api/preferences/report-display/bogus_group/desktop')
        .send({ visible_items: ['weight'] });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request parameters');
      expect(
        reportDisplayPreferenceService.upsertReportDisplayPreference
      ).not.toHaveBeenCalled();
    });

    it('should return 500 on unexpected service error', async () => {
      // @ts-expect-error TS(2339): Property 'mockRejectedValue' does not exist on type
      reportDisplayPreferenceService.upsertReportDisplayPreference.mockRejectedValue(
        new Error('DB error')
      );

      const res = await request(app)
        .put('/api/preferences/report-display/measurement_chart/desktop')
        .send({ visible_items: ['weight'] });

      expect(res.statusCode).toEqual(500);
    });
  });

  describe('DELETE /api/preferences/report-display/:viewGroup/:platform', () => {
    it('should reset a report display preference to default', async () => {
      const defaultPref = {
        user_id: 'test-user-id',
        view_group: 'measurement_chart',
        platform: 'mobile',
        visible_items: [
          'weight',
          'neck',
          'waist',
          'hips',
          'height',
          'body_fat_percentage',
        ],
      };
      // @ts-expect-error TS(2339): Property 'mockResolvedValue' does not exist on type
      reportDisplayPreferenceService.resetReportDisplayPreference.mockResolvedValue(
        defaultPref
      );

      const res = await request(app).delete(
        '/api/preferences/report-display/measurement_chart/mobile'
      );

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual(defaultPref);
      expect(
        reportDisplayPreferenceService.resetReportDisplayPreference
      ).toHaveBeenCalledWith('test-user-id', 'measurement_chart', 'mobile');
    });

    it('should return 400 for an invalid platform param', async () => {
      const res = await request(app).delete(
        '/api/preferences/report-display/measurement_chart/tablet'
      );

      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('error', 'Invalid request parameters');
      expect(
        reportDisplayPreferenceService.resetReportDisplayPreference
      ).not.toHaveBeenCalled();
    });

    it('should return 500 on unexpected service error', async () => {
      // @ts-expect-error TS(2339): Property 'mockRejectedValue' does not exist on type
      reportDisplayPreferenceService.resetReportDisplayPreference.mockRejectedValue(
        new Error('DB error')
      );

      const res = await request(app).delete(
        '/api/preferences/report-display/measurement_chart/mobile'
      );

      expect(res.statusCode).toEqual(500);
    });
  });
});
