import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
// import formbody from "@fastify/formbody";
import { config } from "./config";
import { connectToMongo, closeMongo, getMongoDb } from './utils/mongo';
import { cronService } from './services/cron.service';
import { buildOverallReportHtml, sendOverallReport } from './services/emailNotification.service';
import { authRoutes } from "./routes/auth.routes";
import { boardRoutes } from "./routes/board.routes";
import { sprintRoutes } from "./routes/sprintRoutes";
import { worklogRoutes } from './routes/worklog.routes';
import { gerritRoutes } from './routes/gerrit.routes';
import { reviewRoutes } from './routes/review.routes';
import { registerWorkItemRoutes, registerIssueItemRoutes } from './routes/workItem.routes';
import { registerIssueRoutes } from './routes/issue.routes';
import { sprintPlanningRoutes } from './routes/sprintPlanning.routes';
import { healthRoutes } from './routes/health.routes';

const fastify = Fastify({
	logger: {
		transport: {
			target: 'pino-pretty',
			options: {
				colorize: true,
				translateTime: 'HH:MM:ss',
				ignore: 'pid,hostname'
			}
		}
	}
});

async function startServer() {
  await fastify.register(cors, { origin: "*" });
  await fastify.register(helmet);
//   await fastify.register(formbody);

  fastify.register(authRoutes);
  fastify.register(boardRoutes);
  fastify.register(sprintRoutes);
  fastify.register(worklogRoutes);
  fastify.register(gerritRoutes);
  fastify.register(reviewRoutes);
  fastify.register(registerWorkItemRoutes);
  fastify.register(registerIssueItemRoutes);
  fastify.register(registerIssueRoutes);
  fastify.register(sprintPlanningRoutes);
  fastify.register(healthRoutes);

  // Debug route for cron status
  fastify.get('/cron/status', async (request, reply) => {
    let dbConnected = false;
    let cronConfigs = 0;
    let sprintBoardsCount = 0;
    try {
      getMongoDb();
      dbConnected = true;
      cronConfigs = await getMongoDb().collection('cronConfig').countDocuments({ enabled: { $ne: false } });
      sprintBoardsCount = await getMongoDb().collection('sprintBoards').countDocuments();
    } catch (e) {
      // db not connected
    }
    const cronJobsCount = cronService.getScheduledJobsCount();
    return {
      dbConnected,
      cronJobsScheduled: cronJobsCount,
      cronConfigsEnabled: cronConfigs,
      sprintBoardsCount
    };
  });

  // Manual trigger for cron
  fastify.post('/cron/trigger', async (request, reply) => {
    try {
      const configs = await getMongoDb().collection('cronConfig').find({ enabled: { $ne: false } }).toArray();
      if (!configs || configs.length === 0) {
        return { error: 'No enabled cron configs found' };
      }
      // Trigger for first config as example
      await cronService.triggerSprintWorklogsCronManually(configs[0] as any);
      return { success: true, message: 'Cron triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Manual trigger for email notification (for testing)
  fastify.post('/cron/trigger-email', async (request, reply) => {
    try {
      await cronService.triggerEmailNotification();
      return { success: true, message: 'Email notification triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Preview email HTML in browser without sending
  fastify.get('/cron/preview-email', async (request, reply) => {
    try {
      const html = await cronService.previewEmailHtml();
      reply.header('Content-Type', 'text/html');
      return reply.send(html);
    } catch (e) {
      return { error: e.message };
    }
  });

  // Preview overall report (last 15 days) in browser
  fastify.get('/cron/overall-report', async (_request, reply) => {
    try {
      const html = await buildOverallReportHtml();
      reply.header('Content-Type', 'text/html');
      return reply.send(html);
    } catch (e) {
      return { error: e.message };
    }
  });

  // Manual trigger for Teams due-date notification (for testing)
  fastify.post('/cron/trigger-teams', async (_request, reply) => {
    try {
      await cronService.triggerTeamsNotification();
      return { success: true, message: 'Teams notification triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Manual trigger for reopened issues Teams notification (for testing)
  fastify.post('/cron/trigger-reopened', async (_request, reply) => {
    try {
      await cronService.triggerReopenedNotification();
      return { success: true, message: 'Reopened issues notification triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Manual trigger for due date change Teams notification (for testing)
  fastify.post('/cron/trigger-duedate-change', async (_request, _reply) => {
    try {
      await cronService.triggerDueDateChangeNotification();
      return { success: true, message: 'Due date change notification triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Manual trigger for parked issues Teams notification (for testing)
  fastify.post('/cron/trigger-parked', async (_request, _reply) => {
    try {
      await cronService.triggerParkedNotification();
      return { success: true, message: 'Parked issues notification triggered manually' };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Send overall report email and return HTML for browser preview
  fastify.post('/cron/send-overall-report', async (_request, reply) => {
    try {
      await sendOverallReport();
      const html = await buildOverallReportHtml();
      reply.header('Content-Type', 'text/html');
      return reply.send(html);
    } catch (e) {
      return { error: e.message };
    }
  });

  try {
    const address = await fastify.listen({ port: Number(config.port) });
    fastify.log.info(`🚀 Server running on ${address}`);

    // Connect to MongoDB after the server is listening. Failure won't stop the server.
    try {
      await connectToMongo();
      fastify.log.info('Connected to MongoDB');

      // Initialize cron jobs after MongoDB connection
      // await cronService.initializeCronJobs();

      // Initialize daily email notification cron job
      await cronService.initializeEmailCronJob();

      // Initialize daily Teams due-date notification cron job
      await cronService.initializeTeamsCronJob();

      // Initialize daily Teams reopened issues notification cron job
      await cronService.initializeReopenedCronJob();

      // Initialize daily Teams due date change notification cron job
      await cronService.initializeDueDateChangeCronJob();

      // Initialize daily Teams parked issues notification cron job
      await cronService.initializeParkedCronJob();

      // Initialize daily health snapshot cron job (7:00 AM)
      await cronService.initializeHealthSnapshotCronJob();
    } catch (err) {
      fastify.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Could not connect to MongoDB');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown: close MongoDB client and stop cron jobs if present
process.on('SIGINT', async () => {
  try {
    cronService.stopCronJobs();
    fastify.log.info('Cron jobs stopped');
    
    await closeMongo();
    fastify.log.info('MongoDB connection closed');
  } catch (e) {
    // ignore
  }
  process.exit(0);
});
