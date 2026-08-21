import { FastifyInstance } from 'fastify';
import { runBackfill, runDailySnapshot, getSnapshots, getOpenIssues, deleteAllSnapshots } from '../services/healthSnapshot.service';
import {
    getMemberStats, getMemberIssues, getTeamsAlertLog, getMttrSamples,
    getReopenEvents, getSprintCohorts, getSprintMemberLoad, SprintWindow
} from '../services/memberAnalytics.service';

export async function healthRoutes(fastify: FastifyInstance) {

    // One-time backfill — Jan 1 to today
    fastify.post('/api/health/backfill', async (_request, reply) => {
        try {
            const result = await runBackfill();
            return { success: true, ...result };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Manual trigger for daily snapshot (for testing)
    fastify.post('/api/health/snapshot/trigger', async (_request, reply) => {
        try {
            await runDailySnapshot();
            return { success: true, message: 'Daily snapshot triggered' };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Get snapshots for date range — used by all charts
    // GET /api/health/snapshots?from=2026-01-01&to=2026-07-21
    fastify.get('/api/health/snapshots', async (request, reply) => {
        try {
            const { from, to } = request.query as { from?: string; to?: string };
            const today = new Date().toISOString().slice(0, 10);
            const snapshots = await getSnapshots(from || '2026-01-01', to || today);
            return { snapshots };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Delete all snapshots (use before re-running backfill with corrected JQL)
    fastify.delete('/api/health/snapshots', async (_request, reply) => {
        try {
            const deleted = await deleteAllSnapshots();
            return { success: true, deleted };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Per-member fix speed, outcome mix and backlog forecast (Members Console)
    fastify.get('/api/health/member-stats', async (_request, reply) => {
        try {
            return await getMemberStats();
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Per-issue resolution times for the project × sprint MTTR table
    fastify.get('/api/health/mttr-samples', async (_request, reply) => {
        try {
            const samples = await getMttrSamples();
            return { samples, total: samples.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Per-sprint cohort accounting — carried-in vs newly-logged, and what became of each
    fastify.post('/api/health/sprint-cohorts', async (request, reply) => {
        try {
            const { sprints } = request.body as { sprints?: SprintWindow[] };
            if (!Array.isArray(sprints) || !sprints.length) {
                return reply.status(400).send({ error: 'sprints[] is required' });
            }
            const valid = sprints.filter(s => s?.start && s?.end);
            const rows = await getSprintCohorts(valid);
            return { rows, total: rows.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Per-member workload for one sprint — the Sprint Analysis Report
    fastify.get('/api/health/sprint-member-load', async (request, reply) => {
        try {
            const { start, end } = request.query as { start?: string; end?: string };
            if (!start || !end) return reply.status(400).send({ error: 'start and end are required' });
            return await getSprintMemberLoad(start, end);
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Dated reopen events with source status, for the sprint review metrics
    fastify.get('/api/health/reopen-events', async (_request, reply) => {
        try {
            const events = await getReopenEvents();
            return { events, total: events.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Issue-level drill-down for one member
    fastify.get('/api/health/member-issues', async (request, reply) => {
        try {
            const { name } = request.query as { name?: string };
            if (!name) return reply.status(400).send({ error: 'name is required' });
            const issues = await getMemberIssues(name);
            return { issues, total: issues.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // What the Teams alerts actually contained, logged from the day this shipped
    fastify.get('/api/health/teams-alerts', async (request, reply) => {
        try {
            const { from, to } = request.query as { from?: string; to?: string };
            const alerts = await getTeamsAlertLog(from, to);
            return { alerts, total: alerts.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // Get open/in-progress/fix-ready issues for the live table
    fastify.get('/api/health/open-issues', async (_request, reply) => {
        try {
            const issues = await getOpenIssues();
            return { issues, total: issues.length };
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });
}
