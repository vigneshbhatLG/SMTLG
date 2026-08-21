/**
 * Leads who appear on issues for triage and routing rather than doing the fix.
 *
 * Issues are first assigned to a lead, who then hands them to an engineer, so
 * counting leads in workload or fix credit overstates them and understates whoever
 * actually did the work.
 */
export const LEAD_ASSIGNEES = new Set([
    'anish.td',
    'athulya.p',
    'sumanth.hg',
    'sandhya.k',
]);

export const isLead = (username?: string | null): boolean =>
    !!username && LEAD_ASSIGNEES.has(username.trim().toLowerCase());
