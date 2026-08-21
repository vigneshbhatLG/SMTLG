/**
 * Former Jira usernames mapped to the account each member uses now.
 *
 * Older changelog entries still carry the retired username, which matches nothing
 * in the members collection — so that work was being credited to "outside the team"
 * even though it was ours. Resolving through this map keeps a member's history
 * attached to them across the rename.
 *
 * Keys are the retired name, values the current one as spelled in `members`.
 */
export const MEMBER_ALIASES: Record<string, string> = {
    'karthik.vignesh': 'karthik13.vignesh',
    'leone.jacobsunil': 'leone.sunil',
    'nikhil.sikarwar': 'nikhil11.sikarwar',
    'nayan.kohli': 'nayan.kholi',
    // Moved from an lgepartner.com account to an lge.com one; both are Ganesh Namaji.
    // Mapped onto the existing row so the earlier history stays attached.
    'ganesh04.namaji': 'ganesh.namaji',
};

/** Current username for a possibly-retired one. Passes anything unknown straight through. */
export function resolveAlias(username?: string | null): string {
    if (!username) return '';
    return MEMBER_ALIASES[username.trim().toLowerCase()] || username;
}
