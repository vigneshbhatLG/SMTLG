import { jiraAuthService } from './jiraAuth.service';
import { tokenStore } from '../utils/tokenStore';
import { decryptSymmetric } from '../utils/crypto';

const GERRIT_BASE = "https://wall.lge.com";

function buildBasicAuthHeader(username: string, password: string): string {
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    return `Basic ${token}`;
}

async function callGerrit<T>(path: string, username: string, password: string, options: RequestInit = {}): Promise<T> {
    const url = `${GERRIT_BASE}${path}`;
    const res = await fetch(url, {
        ...(options as any),
        headers: {
            ...(options.headers || {}),
            Authorization: buildBasicAuthHeader(username, password),
            Accept: "application/json",
            "Content-Type": "application/json",
        },
    });

    const text = await res.text();

    if (!res.ok) {
        const short = text && text.length > 200 ? text.slice(0, 200) + "..." : text;
        throw new Error(`Gerrit API error ${res.status} ${res.statusText}: ${short}`);
    }

    // Gerrit JSON responses are XSSI-protected with a leading ")]}'" line — strip it
    const stripped = text.startsWith(")]}'") ? text.replace(/^\)\]\}'\n?/, "") : text;

    try {
        return JSON.parse(stripped) as T;
    } catch (err) {
        throw new Error("Failed to parse Gerrit response JSON: " + err + "\n" + stripped.slice(0, 400));
    }
}

/**
 * Validate HTTP-password credentials by requesting the current account details.
 * Requires the Gerrit `Accounts` endpoint available at /accounts/self/detail
 */
async function validateHttpAuth(username: string, password: string) {
    return callGerrit<any>(`/a/accounts/self/detail`, username, password);
}

/**
 * List changes by query. `query` follows Gerrit query syntax, e.g. `status:open`.
 * Returns an array of changes (may be paginated by Gerrit server depending on query size).
 */
async function listChanges(username: string, password: string, query = "status:open", options: { start?: number; limit?: number } = {}) {
    const params = new URLSearchParams();
    params.set("q", query);
    params.set("O", "81"); // Detailed output options (e.g. LABELS, DETAILED_ACCOUNTS, etc.)
    if (options.start != null) params.set("S", String(options.start));
    if (options.limit != null) params.set("n", String(options.limit));
    console.log("params", params.toString());
    
    // Use the /changes endpoint; prefix with /a to ensure auth is applied
    return callGerrit<any[]>(`/a/changes/?${params.toString()}`, username, password);
}

/**
 * Get detailed change information for a single change id (change number or Change-Id).
 */
async function getChangeDetail(username: string, password: string, changeId: string) {
    // Use the detail view which includes more metadata
    const encoded = encodeURIComponent(changeId);
    return callGerrit<any>(`/a/changes/${encoded}/detail`, username, password);
}

export const gerritService = {
    callGerrit,
    validateHttpAuth,
    listChanges,
    getChangeDetail,
    /**
     * Compute merged change counts per owner between from/to dates, using Jira auth header
     * to resolve the current user and Gerrit HTTP credentials stored in tokenStore.
     *
     * Error messages for routes to translate:
     * - 'MISSING_JIRA_TOKEN'
     * - 'INVALID_JIRA_TOKEN'
     * - 'GERRIT_NOT_CONNECTED'
     * - 'MISSING_FROM_TO'
     */
    async listCountsByOwnerUsingJiraToken(
        authHeaderToken: string | undefined,
        gerritTokenEncrypted: string | undefined,
        ownersRaw: any,
        fromRaw: any,
        toRaw: any,
        projectPrefixRaw?: any,
        pageSize = 200,
        maxPages = 500,
    ): Promise<Record<string, number>> {
        if (!authHeaderToken || String(authHeaderToken).trim().length === 0) {
            throw new Error('MISSING_JIRA_TOKEN');
        }

        // Resolve Jira current user from encrypted PAT
        let jiraUser: any;
        try {
            const plainToken = decryptSymmetric(String(authHeaderToken));
            const res = await jiraAuthService.getCurrentUser(plainToken);
            if (!res.ok) throw new Error('INVALID_JIRA_TOKEN');
            jiraUser = await res.json();
        } catch (e: any) {
            if (e?.message === 'INVALID_JIRA_TOKEN') throw e;
            throw new Error('INVALID_JIRA_TOKEN');
        }

        const username = jiraUser?.name;
        const encryptedGerrit = gerritTokenEncrypted || tokenStore.get(`gerrit:${username}`);
        if (!encryptedGerrit) {
            throw new Error('GERRIT_NOT_CONNECTED');
        }

        // Normalize inputs
        const owners: string[] = Array.isArray(ownersRaw)
            ? ownersRaw.map((o) => String(o)).filter(Boolean)
            : [];
        const from = fromRaw != null ? String(fromRaw) : null;
        const to = toRaw != null ? String(toRaw) : null;
        const projectPrefix = projectPrefixRaw != null ? String(projectPrefixRaw) : null;

        if (!from || !to) {
            throw new Error('MISSING_FROM_TO');
        }

        if (owners.length === 0) {
            return {};
        }

        const decrypted = decryptSymmetric(encryptedGerrit);
        const [gUser, gPass] = decrypted.split(':');

        // If client provided a Gerrit token, ensure it matches the Jira user
        if (gerritTokenEncrypted && gUser !== username) {
            throw new Error('INVALID_JIRA_TOKEN');
        }

        // Build one query for all owners, then aggregate results by change.owner.username
        const ownerClause = owners.map((o) => `owner:${o}`).join(' OR ');
        const query = `status:merged mergedafter:${from} mergedbefore:${to} (${ownerClause})`;

        let start = 0;
        const counts: Record<string, number> = {};
        for (const o of owners) counts[o] = 0;

        let pages = 0;
        while (pages < maxPages) {
            const changes = await listChanges(gUser, gPass, query, { start, limit: pageSize });
            const matched = projectPrefix
                ? changes.filter((c: any) => typeof c?.project === 'string' && c.project.startsWith(projectPrefix))
                : changes;

            for (const change of matched as any[]) {
                const ownerUsername = change?.owner?.username;
                if (ownerUsername && typeof counts[ownerUsername] === 'number') {
                    counts[ownerUsername] += 1;
                }
            }

            if (!changes || changes.length < pageSize) break;
            start += pageSize;
            pages += 1;
        }

        return counts;
    },

    /**
     * Get patch counts for team members based on teamId and date range
     * Fetches team members from MongoDB and queries Gerrit for their patch counts
     * Also fetches applications array from part_teams collection
     */
    async getPatchCountsByTeamId(
        authHeaderToken: string | undefined,
        gerritTokenEncrypted: string | undefined,
        teamId: number,
        from: string,
        to: string,
        projectPrefix?: string,
    ): Promise<{ counts: Record<string, number>; applications: string[] }> {
        if (!authHeaderToken || String(authHeaderToken).trim().length === 0) {
            throw new Error('MISSING_JIRA_TOKEN');
        }

        try {
            // Fetch team members from MongoDB
            const db = require('../utils/mongo').getMongoDb();
            const members = await db.collection('members')
                .find({ teamId: Number(teamId) }, { projection: { name: 1 } })
                .toArray();

            // Fetch applications from part_teams collection
            const partTeam = await db.collection('part_teams')
                .findOne({ teamId: Number(teamId) }, { projection: { applications: 1 } });

            const applications = partTeam?.applications || [];

            if (!members || members.length === 0) {
                return { counts: {}, applications };
            }

            // Extract member names to query Gerrit for patches
            const memberNames = members.map((m: any) => m.name).filter(Boolean);

            if (memberNames.length === 0) {
                return { counts: {}, applications };
            }

            // Use existing method to get patch counts for these owners
            const counts = await this.listCountsByOwnerUsingJiraToken(
                authHeaderToken,
                gerritTokenEncrypted,
                memberNames,
                from,
                to,
                projectPrefix,
            );

            return { counts, applications };
        } catch (err: any) {
            throw err;
        }
    }
};

export default gerritService;
