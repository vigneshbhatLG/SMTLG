import * as cron from 'node-cron';
import { jiraService } from './jira.service';
import { getMongoDb } from '../utils/mongo';
import { config } from '../config';
import { runEmailNotification, previewEmailHtml } from './emailNotification.service';
import { runTeamsNotification, runReopenedNotification, runDueDateChangeNotification, runParkedNotification } from './teams.service';
import { runDailySnapshot } from './healthSnapshot.service';

interface CronJobConfig {
	_id?: string;
	token: string;
	fromDate?: string;
	toDate?: string;
	enabled?: boolean;
}

const scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

/**
 * Initialize and schedule cron jobs for all enabled configs
 * Runs every 15 minutes
 * For each config, fetches all boards from sprintBoards, their sprints, and worklogs
 * Cron pattern: 
 */
export async function initializeCronJobs() {
	try {
		// Load all enabled configurations from MongoDB
		const db = getMongoDb();
		const cronConfigs = await db.collection('cronConfig')
			.find({ enabled: { $ne: false } })
			.toArray();

		if (!cronConfigs || cronConfigs.length === 0) {
			console.warn('No cron configurations found in MongoDB. Please add cronConfig documents.');
			return;
		}

		console.log(`[CRON] Found ${cronConfigs.length} enabled cron configurations`);

		// Schedule a single job that runs for all configs
		const jobId = 'sprint-worklogs-all';
		const scheduledJob = cron.schedule('*/15 * * * *', async () => {
			console.log(`[CRON] Running worklog fetch cycle for all boards at ${new Date().toISOString()}`);
			
			try {
				// Execute fetch for each config in parallel
				const promises = cronConfigs.map((config: any) =>
					runSprintWorklogsCron(config as CronJobConfig).catch((error) => {
						console.error(`[CRON] Error in config ${config._id}:`, error);
						// Don't throw; continue with other configs
					})
				);
				
				await Promise.all(promises);
				console.log(`[CRON] Worklog fetch cycle completed at ${new Date().toISOString()}`);
			} catch (error) {
				console.error('[CRON] Error in cron job execution:', error);
			}
		});

		scheduledJobs.set(jobId, scheduledJob);
		console.log('[CRON] Sprint worklogs cron job scheduled successfully');
		console.log(`[CRON] Schedule: Every 15 minutes (*/15 * * * *) for ${cronConfigs.length} configuration(s)`);
		console.log('[CRON] Flow: sprintBoards → getBoardSprints → getSprintWorklogs (parallel)');
		cronConfigs.forEach((config: any) => {
			console.log(`  - Config ${config._id}: dates from ${config.fromDate || 'N/A'} to ${config.toDate || 'N/A'}`);
		});
	} catch (error) {
		console.error('[CRON] Failed to initialize cron jobs:', error);
	}
}

/**
 * Execute the sprint worklogs fetch for all boards and sprints
 * Fetches boardIds from sprintBoards, then gets sprints for each board,
 * then fetches worklogs for all sprints in parallel
 */
async function runSprintWorklogsCron(config: CronJobConfig) {
	try {
		const { token, fromDate, toDate } = config;

		console.log(`[CRON] Starting worklog fetch cycle for all boards and sprints`);

		// Step 1: Fetch all boards from sprintBoards collection
		const db = getMongoDb();
		const boards = await db.collection('sprintBoards')
			.find({}, { projection: { boardId: 1, teamName: 1 } })
			.toArray();

		if (!boards || boards.length === 0) {
			console.warn('[CRON] No boards found in sprintBoards collection');
			return;
		}

		console.log(`[CRON] Found ${boards.length} boards to process`);

		// Step 2: For each board, get all sprints
		const sprintFetchPromises = boards.map((board: any) =>
			jiraService.getBoardSprints(token, board.boardId)
				.then((sprints: any[]) => ({
					boardId: board.boardId,
					teamName: board.teamName,
					sprints: sprints || []
				}))
				.catch((error) => {
					console.error(`[CRON] Error fetching sprints for board ${board.boardId}:`, error);
					return { boardId: board.boardId, teamName: board.teamName, sprints: [] };
				})
		);

		const boardSprintResults = await Promise.all(sprintFetchPromises);

		// Step 3: Collect all sprint IDs with their corresponding boardId
		const allSprintsToFetch: Array<{ boardId: number; sprintId: number; teamName: string }> = [];
		for (const result of boardSprintResults) {
			if (result.sprints && result.sprints.length > 0) {
				result.sprints.forEach((sprint: any) => {
					allSprintsToFetch.push({
						boardId: result.boardId,
						sprintId: sprint.id,
						teamName: result.teamName
					});
				});
			}
		}

		console.log(`[CRON] Total sprints to fetch worklogs for: ${allSprintsToFetch.length}`);

		if (allSprintsToFetch.length === 0) {
			console.log('[CRON] No sprints found across all boards');
			return;
		}

		// Step 4: Fetch worklogs for all sprints in parallel
		const worklogFetchPromises = allSprintsToFetch.map((item) =>
			jiraService.getSprintWorklogs(
				token,
				item.sprintId,
				fromDate,
				toDate,
				item.boardId,
				true // hardLoad = true to force fresh fetch
			)
				.then(() => {
					console.log(`[CRON] ✓ Successfully fetched worklogs for Sprint ${item.sprintId} (${item.teamName})`);
					return { success: true, sprintId: item.sprintId, boardId: item.boardId };
				})
				.catch((error) => {
					console.error(`[CRON] ✗ Error fetching worklogs for Sprint ${item.sprintId}:`, error);
					return { success: false, sprintId: item.sprintId, boardId: item.boardId, error };
				})
		);

		const results = await Promise.all(worklogFetchPromises);

		// Summary
		const successCount = results.filter((r) => r.success).length;
		const failureCount = results.filter((r) => !r.success).length;

		console.log(`[CRON] Cycle complete: ${successCount} successful, ${failureCount} failed`);
	} catch (error) {
		console.error(`[CRON] Error in cron cycle:`, error);
		throw error;
	}
}

/**
 * Stop all scheduled cron jobs
 */
export function stopCronJobs() {
	for (const [jobId, job] of scheduledJobs) {
		job.stop();
		console.log(`[CRON] Job ${jobId} stopped`);
	}
	scheduledJobs.clear();
	console.log('[CRON] All cron jobs stopped');
}

/**
 * Manually trigger the cron job for testing
 */
export async function triggerSprintWorklogsCronManually(config: CronJobConfig) {
	try {
		console.log('[CRON] Manual trigger of sprint worklogs fetch');
		await runSprintWorklogsCron(config);
		console.log('[CRON] Manual trigger completed successfully');
	} catch (error) {
		console.error('[CRON] Manual trigger failed:', error);
		throw error;
	}
}

/**
 * Initialize the daily email notification cron job
 * Sends email to manager about issues held > 4 days or assigned to same member multiple times
 */
export async function initializeEmailCronJob() {
	try {
		const schedule = config.email.cronSchedule; // default: '40 9 * * 1-5' (9:40 AM weekdays)

		if (!config.email.managerEmail) {
			console.warn('[CRON] MANAGER_EMAIL not configured, skipping email notification cron');
			return;
		}

		const jobId = 'email-notification-daily';
		const scheduledJob = cron.schedule(schedule, async () => {
			console.log(`[CRON] Running daily email notification at ${new Date().toISOString()}`);
			try {
				await runEmailNotification();
			} catch (error) {
				console.error('[CRON] Error in email notification job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log(`[CRON] Email notification cron job scheduled: ${schedule}`);
		console.log(`[CRON] Recipient: ${config.email.managerEmail}`);
	} catch (error) {
		console.error('[CRON] Failed to initialize email notification cron:', error);
	}
}

export async function initializeTeamsCronJob() {
	try {
		if (!config.teams.webhookUrl) {
			console.warn('[CRON] TEAMS_WEBHOOK_URL_INTERNAL not configured, skipping Teams notification cron');
			return;
		}

		const jobId = 'teams-notification-daily';
		const scheduledJob = cron.schedule(config.teams.cronSchedule, async () => {
			console.log(`[CRON] Running daily Teams due-date notification at ${new Date().toISOString()}`);
			try {
				await runTeamsNotification();
			} catch (error) {
				console.error('[CRON] Error in Teams notification job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log(`[CRON] Teams notification cron job scheduled: ${config.teams.cronSchedule}`);
	} catch (error) {
		console.error('[CRON] Failed to initialize Teams notification cron:', error);
	}
}

export async function initializeReopenedCronJob() {
	try {
		if (!config.teams.reopenWebhookUrl) {
			console.warn('[CRON] TEAMS_WEBHOOK_URL_PLS not configured, skipping reopened notification cron');
			return;
		}

		const jobId = 'teams-reopened-daily';
		const scheduledJob = cron.schedule(config.teams.reopenCronSchedule, async () => {
			console.log(`[CRON] Running daily reopened issues notification at ${new Date().toISOString()}`);
			try {
				await runReopenedNotification();
			} catch (error) {
				console.error('[CRON] Error in reopened notification job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log(`[CRON] Reopened issues cron job scheduled: ${config.teams.reopenCronSchedule}`);
	} catch (error) {
		console.error('[CRON] Failed to initialize reopened notification cron:', error);
	}
}

export async function initializeDueDateChangeCronJob() {
	try {
		if (!config.teams.dueDateChangeWebhookUrl) {
			console.warn('[CRON] TEAMS_WEBHOOK_URL_PLS not configured, skipping due date change cron');
			return;
		}

		const jobId = 'teams-duedate-change-daily';
		const scheduledJob = cron.schedule(config.teams.dueDateChangeCronSchedule, async () => {
			console.log(`[CRON] Running daily due date change notification at ${new Date().toISOString()}`);
			try {
				await runDueDateChangeNotification();
			} catch (error) {
				console.error('[CRON] Error in due date change notification job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log(`[CRON] Due date change cron job scheduled: ${config.teams.dueDateChangeCronSchedule}`);
	} catch (error) {
		console.error('[CRON] Failed to initialize due date change cron:', error);
	}
}

export async function initializeParkedCronJob() {
	try {
		if (!config.teams.parkedWebhookUrl) {
			console.warn('[CRON] TEAMS_WEBHOOK_URL_PLS not configured, skipping parked issues cron');
			return;
		}

		const jobId = 'teams-parked-daily';
		const scheduledJob = cron.schedule(config.teams.parkedCronSchedule, async () => {
			console.log(`[CRON] Running daily parked issues notification at ${new Date().toISOString()}`);
			try {
				await runParkedNotification();
			} catch (error) {
				console.error('[CRON] Error in parked issues notification job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log(`[CRON] Parked issues cron job scheduled: ${config.teams.parkedCronSchedule}`);
	} catch (error) {
		console.error('[CRON] Failed to initialize parked issues cron:', error);
	}
}

export async function initializeHealthSnapshotCronJob() {
	try {
		const jobId = 'health-snapshot-daily';
		const scheduledJob = cron.schedule('0 7 * * *', async () => {
			console.log(`[CRON] Running daily health snapshot at ${new Date().toISOString()}`);
			try {
				await runDailySnapshot();
			} catch (error) {
				console.error('[CRON] Error in health snapshot job:', error);
			}
		}, { timezone: 'Asia/Kolkata' });

		scheduledJobs.set(jobId, scheduledJob);
		console.log('[CRON] Health snapshot cron job scheduled: 7:00 AM daily');
	} catch (error) {
		console.error('[CRON] Failed to initialize health snapshot cron:', error);
	}
}

export const cronService = {
	initializeCronJobs,
	initializeEmailCronJob,
	initializeTeamsCronJob,
	initializeReopenedCronJob,
	initializeDueDateChangeCronJob,
	initializeParkedCronJob,
	initializeHealthSnapshotCronJob,
	stopCronJobs,
	triggerSprintWorklogsCronManually,
	triggerEmailNotification: runEmailNotification,
	triggerTeamsNotification: runTeamsNotification,
	triggerReopenedNotification: runReopenedNotification,
	triggerDueDateChangeNotification: runDueDateChangeNotification,
	triggerParkedNotification: runParkedNotification,
	previewEmailHtml,
	getScheduledJobsCount: () => scheduledJobs.size,
};
