/**
 * Bounty API — Express Router for campaigns & tasks CRUD.
 *
 * Exports a factory function `createBountyRouter` that accepts dependencies
 * (workspacesRoot, requireSessionApi) to avoid circular imports with webchat.ts.
 *
 * Endpoints:
 *   POST   /campaigns                          — create campaign (auth required)
 *   GET    /campaigns                          — list creator's campaigns (auth required)
 *   GET    /campaigns/:campaignId              — single campaign (public)
 *   POST   /campaigns/:campaignId/tasks        — create task (auth + ownership)
 *   GET    /campaigns/:campaignId/tasks        — list tasks (public)
 *   DELETE /campaigns/:campaignId/tasks/:taskId — delete task (auth + ownership, cascade reject)
 *   POST   /campaigns/:campaignId/publish      — publish campaign (auth + ownership)
 *
 * Data stored in: group_data/user_{creatorId}/data/campaigns.json, tasks.json, submissions.json
 */

import express from 'express';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Campaign created by a webchat user. */
interface Campaign {
  id: string;
  creatorId: number;
  title: string;
  description: string;
  status: 'draft' | 'published';
  createdAt: string;
}

/** Task within a campaign. */
interface Task {
  id: string;
  campaignId: string;
  title: string;
  description: string;
  reward: number;
  createdAt: string;
}

/** Submission by a participant (minimal — needed for cascade reject on task delete). */
interface Submission {
  id: string;
  campaignId: string;
  taskId: string;
  participantId: string;
  participantName: string;
  proof: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  pointsAwarded?: number;
}

/** WebUser type matching webchat.ts (attached by requireSessionApi). */
interface WebUser {
  userId: number;
  email: string;
  name: string;
  nickname: string;
  createdAt: string;
}

/** Dependencies injected from webchat.ts. */
interface BountyRouterDeps {
  workspacesRoot: string;
  requireSessionApi: (req: express.Request, res: express.Response, next: express.NextFunction) => void;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Regex for safe IDs in file paths (prevents path traversal). */
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validates that an ID is safe for use in file paths.
 * @param id - The ID to validate
 * @returns true if the ID matches the safe pattern
 */
function isValidId(id: string): boolean {
  return SAFE_ID_REGEX.test(id);
}

// ─── File I/O Helpers ────────────────────────────────────────────────────────

/**
 * Ensures a directory exists, creating it recursively if needed.
 * @param dirPath - Directory path to ensure
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Atomically writes JSON to a file (write to tmp, then rename).
 * @param filePath - Target file path
 * @param value - Value to serialize as JSON
 */
function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Reads a JSON file, returning fallback if file does not exist or is invalid.
 * @param filePath - File path to read
 * @param fallback - Default value if file missing/corrupt
 * @returns Parsed JSON or fallback
 */
function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

// ─── Helper: extract webUser from req ────────────────────────────────────────

/**
 * Extracts WebUser from request (set by requireSessionApi middleware).
 * @param req - Express request
 * @returns WebUser object
 * @throws Error if webUser is not attached (internal error)
 */
function getReqUser(req: express.Request): WebUser {
  const attached = (req as unknown as { webUser?: WebUser }).webUser;
  if (!attached) {
    throw new Error('Internal error: missing webUser');
  }
  return attached;
}

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Creates Express Router with all bounty campaign and task endpoints.
 *
 * @param deps - Dependencies from webchat.ts
 * @param deps.workspacesRoot - Path to group_data directory
 * @param deps.requireSessionApi - Middleware that enforces webchat session auth
 * @returns Express Router to be mounted at /api/bounty
 */
export function createBountyRouter(deps: BountyRouterDeps): express.Router {
  const { workspacesRoot, requireSessionApi } = deps;
  const router = express.Router();

  // Ensure JSON body parsing (may already be applied globally, but safe to add)
  router.use(express.json());

  // ─── Path Helpers ────────────────────────────────────────────────────

  /** Returns path to user's data directory. */
  function userDataDir(userId: number): string {
    return path.join(workspacesRoot, `user_${userId}`, 'data');
  }

  /** Returns path to campaigns.json for a user. */
  function campaignsPath(userId: number): string {
    return path.join(userDataDir(userId), 'campaigns.json');
  }

  /** Returns path to tasks.json for a user. */
  function tasksPath(userId: number): string {
    return path.join(userDataDir(userId), 'tasks.json');
  }

  /** Returns path to submissions.json for a user. */
  function submissionsPath(userId: number): string {
    return path.join(userDataDir(userId), 'submissions.json');
  }

  // ─── Data Access ─────────────────────────────────────────────────────

  function readCampaigns(userId: number): Campaign[] {
    return readJsonFile<Campaign[]>(campaignsPath(userId), []);
  }

  function writeCampaigns(userId: number, campaigns: Campaign[]): void {
    writeJsonAtomic(campaignsPath(userId), campaigns);
  }

  function readTasks(userId: number): Task[] {
    return readJsonFile<Task[]>(tasksPath(userId), []);
  }

  function writeTasks(userId: number, tasks: Task[]): void {
    writeJsonAtomic(tasksPath(userId), tasks);
  }

  function readSubmissions(userId: number): Submission[] {
    return readJsonFile<Submission[]>(submissionsPath(userId), []);
  }

  function writeSubmissions(userId: number, submissions: Submission[]): void {
    writeJsonAtomic(submissionsPath(userId), submissions);
  }

  /**
   * Finds the creatorId who owns a campaign by scanning all user directories.
   * Used for public endpoints where we do not know the creator in advance.
   *
   * @param campaignId - Campaign ID to find
   * @returns Object with campaign data and creatorId, or null if not found
   */
  function findCampaignGlobally(campaignId: string): { campaign: Campaign; creatorId: number } | null {
    // First check if workspacesRoot exists
    if (!fs.existsSync(workspacesRoot)) {
      return null;
    }

    const entries = fs.readdirSync(workspacesRoot);
    for (const entry of entries) {
      const match = /^user_(\d+)$/.exec(entry);
      if (!match) continue;
      const userId = parseInt(match[1], 10);
      if (!Number.isFinite(userId)) continue;

      const campaigns = readCampaigns(userId);
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (campaign) {
        return { campaign, creatorId: userId };
      }
    }
    return null;
  }

  // ─── Campaign Endpoints ──────────────────────────────────────────────

  /**
   * POST /campaigns — Create a new campaign.
   * Requires session auth. Creates campaign with status='draft'.
   */
  router.post('/campaigns', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const { title, description } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'title is required and must be a non-empty string' });
      return;
    }

    const campaign: Campaign = {
      id: crypto.randomUUID(),
      creatorId: user.userId,
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      status: 'draft',
      createdAt: new Date().toISOString(),
    };

    const campaigns = readCampaigns(user.userId);
    campaigns.push(campaign);
    writeCampaigns(user.userId, campaigns);

    console.log(`[bounty] Campaign created: ${campaign.id} by user ${user.userId}`);
    res.status(201).json(campaign);
  });

  /**
   * GET /campaigns — List all campaigns for the authenticated creator.
   * Requires session auth.
   */
  router.get('/campaigns', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const campaigns = readCampaigns(user.userId);
    res.json(campaigns);
  });

  /**
   * GET /campaigns/:campaignId — Get a single campaign by ID.
   * Public endpoint (no auth required).
   * Searches across all user directories to find the campaign.
   */
  router.get('/campaigns/:campaignId', (req, res) => {
    const { campaignId } = req.params;

    if (!isValidId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID format' });
      return;
    }

    const result = findCampaignGlobally(campaignId);
    if (!result) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    res.json(result.campaign);
  });

  // ─── Task Endpoints ──────────────────────────────────────────────────

  /**
   * POST /campaigns/:campaignId/tasks — Create a task in a campaign.
   * Requires session auth + campaign ownership. reward must be > 0.
   */
  router.post('/campaigns/:campaignId/tasks', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const { campaignId } = req.params;

    if (!isValidId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID format' });
      return;
    }

    // Verify campaign exists and belongs to current user
    const campaigns = readCampaigns(user.userId);
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      // Check if campaign exists but belongs to another user
      const globalResult = findCampaignGlobally(campaignId);
      if (globalResult) {
        res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
        return;
      }
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Verify ownership: campaign.creatorId must match authenticated user
    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    const { title, description, reward } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'title is required and must be a non-empty string' });
      return;
    }

    // Validate reward: must be number, finite, and > 0
    if (typeof reward !== 'number' || !Number.isFinite(reward) || reward <= 0) {
      res.status(400).json({ error: 'reward must be a positive number greater than 0' });
      return;
    }

    const task: Task = {
      id: crypto.randomUUID(),
      campaignId,
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      reward,
      createdAt: new Date().toISOString(),
    };

    const tasks = readTasks(user.userId);
    tasks.push(task);
    writeTasks(user.userId, tasks);

    console.log(`[bounty] Task created: ${task.id} in campaign ${campaignId}`);
    res.status(201).json(task);
  });

  /**
   * GET /campaigns/:campaignId/tasks — List tasks for a campaign.
   * Public endpoint (no auth required).
   */
  router.get('/campaigns/:campaignId/tasks', (req, res) => {
    const { campaignId } = req.params;

    if (!isValidId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID format' });
      return;
    }

    // Find campaign globally to get the creatorId
    const result = findCampaignGlobally(campaignId);
    if (!result) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const tasks = readTasks(result.creatorId);
    const campaignTasks = tasks.filter((t) => t.campaignId === campaignId);
    res.json(campaignTasks);
  });

  /**
   * DELETE /campaigns/:campaignId/tasks/:taskId — Delete a task.
   * Requires session auth + campaign ownership.
   * If there are pending submissions for this taskId, they are auto-rejected (AC-14).
   */
  router.delete('/campaigns/:campaignId/tasks/:taskId', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const { campaignId, taskId } = req.params;

    if (!isValidId(campaignId) || !isValidId(taskId)) {
      res.status(400).json({ error: 'Invalid ID format' });
      return;
    }

    // Verify campaign ownership
    const campaigns = readCampaigns(user.userId);
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      const globalResult = findCampaignGlobally(campaignId);
      if (globalResult) {
        res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
        return;
      }
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Verify ownership: campaign.creatorId must match authenticated user
    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    // Find and remove the task
    const tasks = readTasks(user.userId);
    const taskIndex = tasks.findIndex((t) => t.id === taskId && t.campaignId === campaignId);
    if (taskIndex === -1) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    tasks.splice(taskIndex, 1);
    writeTasks(user.userId, tasks);

    // Cascade: reject all pending submissions for this taskId (AC-14)
    const submissions = readSubmissions(user.userId);
    let rejectedCount = 0;
    for (const sub of submissions) {
      if (sub.taskId === taskId && sub.status === 'pending') {
        sub.status = 'rejected';
        sub.reviewedAt = new Date().toISOString();
        rejectedCount++;
      }
    }
    if (rejectedCount > 0) {
      writeSubmissions(user.userId, submissions);
      console.log(`[bounty] Cascade rejected ${rejectedCount} pending submissions for task ${taskId}`);
    }

    console.log(`[bounty] Task deleted: ${taskId} from campaign ${campaignId}`);
    res.json({ deleted: taskId, rejectedSubmissions: rejectedCount });
  });

  // ─── Publish Endpoint ────────────────────────────────────────────────

  /**
   * POST /campaigns/:campaignId/publish — Publish a campaign (draft → published).
   * Requires session auth + campaign ownership.
   * Requires at least one task. Idempotent: re-publishing returns 200.
   */
  router.post('/campaigns/:campaignId/publish', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const { campaignId } = req.params;

    if (!isValidId(campaignId)) {
      res.status(400).json({ error: 'Invalid campaign ID format' });
      return;
    }

    // Verify campaign ownership
    const campaigns = readCampaigns(user.userId);
    const campaignIndex = campaigns.findIndex((c) => c.id === campaignId);
    if (campaignIndex === -1) {
      const globalResult = findCampaignGlobally(campaignId);
      if (globalResult) {
        res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
        return;
      }
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const campaign = campaigns[campaignIndex];

    // Verify ownership: campaign.creatorId must match authenticated user
    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    // Idempotent: if already published, return 200 without changes
    if (campaign.status === 'published') {
      res.json(campaign);
      return;
    }

    // Check that campaign has at least one task
    const tasks = readTasks(user.userId);
    const campaignTasks = tasks.filter((t) => t.campaignId === campaignId);
    if (campaignTasks.length === 0) {
      res.status(400).json({ error: 'Cannot publish campaign without tasks. Add at least one task first.' });
      return;
    }

    // Publish
    campaign.status = 'published';
    campaigns[campaignIndex] = campaign;
    writeCampaigns(user.userId, campaigns);

    console.log(`[bounty] Campaign published: ${campaignId}`);
    res.json(campaign);
  });

  return router;
}
