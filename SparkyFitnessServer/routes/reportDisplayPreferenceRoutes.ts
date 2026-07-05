import express from 'express';
import { z } from 'zod/v4';
import reportDisplayPreferenceService from '../services/reportDisplayPreferenceService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { log } from '../config/logging.js';
import { MEASUREMENT_CHART_ITEMS } from '@workspace/shared';

const ReportDisplayPreferenceParamsSchema = z.object({
  viewGroup: z.enum(['measurement_chart']),
  platform: z.enum(['desktop', 'mobile']),
});

const UpsertReportDisplayPreferenceBodySchema = z.object({
  visible_items: z
    .array(z.enum(MEASUREMENT_CHART_ITEMS))
    .refine((items) => new Set(items).size === items.length, {
      message: 'visible_items must contain unique items',
    }),
});

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Reports & Display Preferences
 *   description: User preferences for which report/chart items are visible per platform.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ReportDisplayPreference:
 *       type: object
 *       properties:
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: The ID of the user who owns the preference.
 *         view_group:
 *           type: string
 *           description: The report view group the preference applies to (e.g., "measurement_chart").
 *         platform:
 *           type: string
 *           description: The platform the preference applies to ("desktop" or "mobile").
 *         visible_items:
 *           type: array
 *           items:
 *             type: string
 *           description: An array of item keys that should be visible, in display order.
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *       required:
 *         - user_id
 *         - view_group
 *         - platform
 *         - visible_items
 */

/**
 * @swagger
 * /preferences/report-display:
 *   get:
 *     summary: Get all report display preferences for the logged-in user
 *     tags: [Reports & Display Preferences]
 *     description: Retrieves the complete set of report display preferences (all view groups x platforms) for the authenticated user, falling back to defaults where none exist.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A list of report display preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ReportDisplayPreference'
 *       401:
 *         description: Unauthorized, authentication token is missing or invalid.
 *       500:
 *         description: Failed to fetch report display preferences.
 */
router.get('/', async (req, res, next) => {
  try {
    const preferences =
      await reportDisplayPreferenceService.getReportDisplayPreferences(
        req.userId
      );
    res.status(200).json(preferences);
  } catch (error) {
    log(
      'error',
      `Error fetching report display preferences: ${error instanceof Error ? error.message : String(error)}`,
      {
        userId: req.userId,
      }
    );
    next(error);
  }
});

/**
 * @swagger
 * /preferences/report-display/{viewGroup}/{platform}:
 *   put:
 *     summary: Upsert a report display preference
 *     tags: [Reports & Display Preferences]
 *     description: Creates or updates a report display preference for a specific view group and platform for the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: viewGroup
 *         required: true
 *         schema:
 *           type: string
 *         description: The report view group (e.g., "measurement_chart").
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *         description: The platform ("desktop" or "mobile").
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - visible_items
 *             properties:
 *               visible_items:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: An array of item keys that should be visible, in display order.
 *     responses:
 *       200:
 *         description: The report display preference was upserted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReportDisplayPreference'
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Unauthorized, authentication token is missing or invalid.
 *       500:
 *         description: Failed to upsert report display preference.
 */
router.put('/:viewGroup/:platform', async (req, res, next) => {
  try {
    const paramsResult = ReportDisplayPreferenceParamsSchema.safeParse(
      req.params
    );
    if (!paramsResult.success) {
      res.status(400).json({ error: 'Invalid request parameters' });
      return;
    }
    const bodyResult = UpsertReportDisplayPreferenceBodySchema.safeParse(
      req.body
    );
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }
    const { viewGroup, platform } = paramsResult.data;
    const { visible_items } = bodyResult.data;
    const preference =
      await reportDisplayPreferenceService.upsertReportDisplayPreference(
        req.userId,
        viewGroup,
        platform,
        visible_items
      );
    res.status(200).json(preference);
  } catch (error) {
    log(
      'error',
      `Error upserting report display preference: ${error instanceof Error ? error.message : String(error)}`,
      {
        userId: req.userId,
      }
    );
    next(error);
  }
});

/**
 * @swagger
 * /preferences/report-display/{viewGroup}/{platform}:
 *   delete:
 *     summary: Reset a report display preference to default
 *     tags: [Reports & Display Preferences]
 *     description: Resets a specific report display preference to its default settings for the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: viewGroup
 *         required: true
 *         schema:
 *           type: string
 *         description: The report view group (e.g., "measurement_chart").
 *       - in: path
 *         name: platform
 *         required: true
 *         schema:
 *           type: string
 *         description: The platform ("desktop" or "mobile").
 *     responses:
 *       200:
 *         description: The report display preference was reset successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReportDisplayPreference'
 *       401:
 *         description: Unauthorized, authentication token is missing or invalid.
 *       500:
 *         description: Failed to reset report display preference.
 */
router.delete('/:viewGroup/:platform', async (req, res, next) => {
  try {
    const paramsResult = ReportDisplayPreferenceParamsSchema.safeParse(
      req.params
    );
    if (!paramsResult.success) {
      res.status(400).json({ error: 'Invalid request parameters' });
      return;
    }
    const { viewGroup, platform } = paramsResult.data;
    const defaultPreference =
      await reportDisplayPreferenceService.resetReportDisplayPreference(
        req.userId,
        viewGroup,
        platform
      );
    res.status(200).json(defaultPreference);
  } catch (error) {
    log(
      'error',
      `Error resetting report display preference: ${error instanceof Error ? error.message : String(error)}`,
      {
        userId: req.userId,
      }
    );
    next(error);
  }
});

export default router;
