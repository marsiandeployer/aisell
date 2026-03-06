/**
 * Bounty API — Express Router for campaigns, tasks, and escrow CRUD.
 *
 * Exports a factory function `createBountyRouter` that accepts dependencies
 * (workspacesRoot, requireSessionApi) to avoid circular imports with webchat.ts.
 *
 * Endpoints:
 *   POST   /campaigns                              — create campaign (auth required)
 *   GET    /campaigns                              — list creator's campaigns (auth required)
 *   GET    /campaigns/:campaignId                  — single campaign (public)
 *   POST   /campaigns/:campaignId/tasks            — create task (auth + ownership)
 *   GET    /campaigns/:campaignId/tasks            — list tasks (public)
 *   DELETE /campaigns/:campaignId/tasks/:taskId     — delete task (auth + ownership, cascade reject)
 *   POST   /campaigns/:campaignId/publish          — publish campaign (auth + ownership)
 *   POST   /campaigns/:campaignId/escrow/deposit   — deposit points to escrow (auth + ownership)
 *   GET    /campaigns/:campaignId/escrow/balance   — get escrow balance (auth + ownership)
 *   POST   /submissions/:submissionId/approve      — approve submission (auth + ownership, escrow debit)
 *
 * Also exports `debitEscrow` function for use in Task 4 (auto-approve flow).
 *
 * Data stored in: group_data/user_{creatorId}/data/campaigns.json, tasks.json, submissions.json,
 *                 escrow_{campaignId}.json
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

/** Escrow account for a single campaign. One file per campaign: escrow_{campaignId}.json */
interface Escrow {
  campaignId: string;
  balance: number;
  transactions: EscrowTx[];
}

/** Single escrow transaction (deposit or debit). */
interface EscrowTx {
  type: 'deposit' | 'debit';
  amount: number;
  ref: string;               // submissionId or 'manual'
  initiatedBy: 'creator' | 'auto-approve';  // audit trail
  createdAt: string;          // ISO 8601
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

  /** Returns path to escrow_{campaignId}.json for a user. */
  function escrowPath(userId: number, campaignId: string): string {
    return path.join(userDataDir(userId), `escrow_${campaignId}.json`);
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
   * Reads escrow data for a campaign. Returns default { balance: 0 } if file missing (cold-start).
   * @param userId - Creator user ID
   * @param campaignId - Campaign ID
   */
  function readEscrow(userId: number, campaignId: string): Escrow {
    return readJsonFile<Escrow>(escrowPath(userId, campaignId), {
      campaignId,
      balance: 0,
      transactions: [],
    });
  }

  /**
   * Writes escrow data atomically for a campaign.
   * @param userId - Creator user ID
   * @param campaignId - Campaign ID
   * @param escrow - Escrow data to write
   */
  function writeEscrow(userId: number, campaignId: string, escrow: Escrow): void {
    writeJsonAtomic(escrowPath(userId, campaignId), escrow);
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

  // ─── Escrow Endpoints ───────────────────────────────────────────────

  /**
   * POST /campaigns/:campaignId/escrow/deposit — Deposit points to campaign escrow.
   * Requires session auth + campaign ownership. amount must be > 0.
   */
  router.post('/campaigns/:campaignId/escrow/deposit', requireSessionApi, (req, res) => {
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
      const globalResult = findCampaignGlobally(campaignId);
      if (globalResult) {
        res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
        return;
      }
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    const { amount } = req.body;

    // Validate amount: must be number, finite, and > 0
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number greater than 0' });
      return;
    }

    // Read current escrow, increase balance, add transaction
    const escrow = readEscrow(user.userId, campaignId);
    escrow.balance += amount;
    escrow.transactions.push({
      type: 'deposit',
      amount,
      ref: 'manual',
      initiatedBy: 'creator',
      createdAt: new Date().toISOString(),
    });
    writeEscrow(user.userId, campaignId, escrow);

    console.log(`[bounty] Escrow deposit: ${amount} points to campaign ${campaignId} by user ${user.userId}`);
    res.json({ balance: escrow.balance });
  });

  /**
   * GET /campaigns/:campaignId/escrow/balance — Get escrow balance.
   * Requires session auth + campaign ownership.
   * Returns { balance, warning: true } if balance === 0.
   */
  router.get('/campaigns/:campaignId/escrow/balance', requireSessionApi, (req, res) => {
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
      const globalResult = findCampaignGlobally(campaignId);
      if (globalResult) {
        res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
        return;
      }
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    const escrow = readEscrow(user.userId, campaignId);
    const result: { balance: number; warning?: boolean } = { balance: escrow.balance };
    if (escrow.balance === 0) {
      result.warning = true;
    }
    res.json(result);
  });

  // ─── Submission Approve Endpoint ────────────────────────────────────

  /**
   * POST /submissions/:submissionId/approve — Approve a submission.
   * Requires session auth + campaign ownership (via submission.campaignId).
   * Debits escrow by task.reward; returns 402 if insufficient balance.
   */
  router.post('/submissions/:submissionId/approve', requireSessionApi, (req, res) => {
    const user = getReqUser(req);
    const { submissionId } = req.params;

    if (!isValidId(submissionId)) {
      res.status(400).json({ error: 'Invalid submission ID format' });
      return;
    }

    // Find submission in creator's data
    const submissions = readSubmissions(user.userId);
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) {
      res.status(404).json({ error: 'Submission not found' });
      return;
    }

    // Verify campaign ownership
    const campaigns = readCampaigns(user.userId);
    const campaign = campaigns.find((c) => c.id === submission.campaignId);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    if (campaign.creatorId !== user.userId) {
      res.status(403).json({ error: 'Forbidden: campaign belongs to another user' });
      return;
    }

    // Only pending submissions can be approved
    if (submission.status !== 'pending') {
      res.status(400).json({ error: `Submission is already ${submission.status}` });
      return;
    }

    // Find the task to get reward amount
    const tasks = readTasks(user.userId);
    const task = tasks.find((t) => t.id === submission.taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    // Debit escrow
    try {
      debitEscrow(user.userId, submission.campaignId, task.reward, submissionId, 'creator');
    } catch (err: unknown) {
      const escrowErr = err as { status?: number; message?: string };
      if (escrowErr.status === 402) {
        res.status(402).json({ error: 'Insufficient escrow balance' });
        return;
      }
      if (escrowErr.status === 409) {
        res.status(409).json({ error: 'Concurrent approval conflict, please retry' });
        return;
      }
      throw err;
    }

    // Update submission status
    submission.status = 'approved';
    submission.reviewedAt = new Date().toISOString();
    submission.pointsAwarded = task.reward;
    writeSubmissions(user.userId, submissions);

    console.log(`[bounty] Submission approved: ${submissionId}, ${task.reward} points debited from escrow`);
    res.json({ approved: submissionId, pointsAwarded: task.reward });
  });

  // ─── Debit Function ─────────────────────────────────────────────────

  /**
   * Debit escrow: atomic read-modify-write with post-write rollback.
   * Exposed on the router for Task 4 (auto-approve flow).
   *
   * @param creatorId - Creator user ID who owns the campaign
   * @param campaignId - Campaign ID
   * @param amount - Points to debit
   * @param ref - Reference (submissionId or description)
   * @param initiatedBy - 'creator' for manual approve, 'auto-approve' for automatic
   * @returns New balance after debit
   * @throws Error with status 402 if balance < amount (pre-check)
   * @throws Error with status 409 if post-write balance < 0 (race condition rollback)
   */
  function debitEscrow(
    creatorId: number,
    campaignId: string,
    amount: number,
    ref: string,
    initiatedBy: 'creator' | 'auto-approve',
  ): number {
    // Read snapshot for potential rollback
    const snapshot = readEscrow(creatorId, campaignId);

    // Pre-check: insufficient funds — avoid a pointless write
    if (snapshot.balance < amount) {
      const err = new Error('Insufficient escrow balance') as Error & { status: number };
      err.status = 402;
      throw err;
    }

    // Read-modify-write
    const escrow = readEscrow(creatorId, campaignId);
    escrow.balance -= amount;
    escrow.transactions.push({
      type: 'debit',
      amount,
      ref,
      initiatedBy,
      createdAt: new Date().toISOString(),
    });
    writeEscrow(creatorId, campaignId, escrow);

    // Post-write check: re-read to detect race condition
    const check = readEscrow(creatorId, campaignId);
    if (check.balance < 0) {
      // Rollback: restore pre-debit snapshot
      writeEscrow(creatorId, campaignId, snapshot);
      console.log(`[bounty] Escrow rollback: balance went negative for campaign ${campaignId}, restored to ${snapshot.balance}`);
      const err = new Error('Concurrent debit detected, rollback applied') as Error & { status: number };
      err.status = 409;
      throw err;
    }

    return check.balance;
  }

  // Expose debitEscrow on the router for external use (Task 4: auto-approve)
  (router as express.Router & { debitEscrow: typeof debitEscrow }).debitEscrow = debitEscrow;

  return router;
}

/**
 * Type for the bounty router with debitEscrow attached.
 * Used by Task 4 to call debitEscrow from auto-approve flow.
 */
export type BountyRouter = express.Router & {
  debitEscrow: (
    creatorId: number,
    campaignId: string,
    amount: number,
    ref: string,
    initiatedBy: 'creator' | 'auto-approve',
  ) => number;
};
