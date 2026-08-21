/**
 * How a reopen should be read, based on the resolution the issue was reopened from.
 *
 * Shared by the snapshot builder and the analytics service so the dashboard cards and
 * the sprint report can never disagree about what counts as actionable.
 *
 *  - afterFix  the issue was closed on the strength of the code — either a delivered
 *              fix, or a "Cannot Reproduce" call made against the build — and it came
 *              back. This is the engineering signal.
 *  - other     closed on a judgement about the issue itself: Not a Bug, Duplicate,
 *              Won't Fix, Deferred, Withdrawn. A reopen here is a triage problem, not
 *              a code problem.
 *
 * Ownership is a separate axis: an afterFix reopen on a fix delivered by another team
 * is reported as "Outside" rather than counted against this team.
 */
export type ReopenImpact = 'afterFix' | 'other' | 'unknown';

/** Closed on the code: a delivered fix, or judged not reproducible against the build. */
export const CODE_FIX_RESOLUTION = /^(fixed|done|resolved|cannot reproduce)/i;

/** Closed on a judgement about the issue rather than the code. */
const TRIAGE_RESOLUTION =
    /^(not a bug|duplicate|won'?t fix|won'?t do|invalid|rejected|deferred|withdrawn)/i;

export function classifyReopenImpact(fromResolution?: string | null): ReopenImpact {
    const r = (fromResolution || '').trim();
    if (!r) return 'unknown';
    if (CODE_FIX_RESOLUTION.test(r)) return 'afterFix';
    if (TRIAGE_RESOLUTION.test(r)) return 'other';
    return 'unknown';
}
