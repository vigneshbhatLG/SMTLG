import { AuthorizationCode } from "simple-oauth2";
import { config } from "../config";
import { getMongoDb } from "../utils/mongo";

const client = new AuthorizationCode({
    client: {
        id: config.jira.clientId,
        secret: config.jira.clientSecret,
    },
    auth: {
        tokenHost: "http://jira.lge.com",
        tokenPath: "/oauth/token",
        authorizePath: "/authorize",
    },
});

export const jiraAuthService = {
    // Login URL (user is redirected to Jira to grant permission)
    getCurrentUser: async (token) => {
        const res = await fetch("http://jira.lge.com/issue/rest/api/2/myself", {
            headers: { Authorization: `Bearer ${token}` }
        });
        return res;
    }
    ,
    lookupMemberInfo: async (
        jiraName: string | null | undefined
    ): Promise<{ memberRole: string | null; teamId: string | number | null; teams?: any[] }> => {
        if (!jiraName) return { memberRole: null, teamId: null, teams: [] };
        try {
            const db = getMongoDb();
            const membersCol = db.collection('members');
            const query = { name: String(jiraName) };
            const opts = { projection: { role: 1, teamId: 1 } } as any;
            const row: any = await membersCol.findOne(query, opts);

            const memberRole = row?.role != null ? String(row.role) : null;
            const teamId = row?.teamId != null ? row.teamId : null;
            
            // Fetch all documents from part_teams collection
            const teamsCol = db.collection('part_teams');
            const teams = await teamsCol.find({}).toArray();
            
            return { memberRole, teamId, teams };
        } catch {
            return { memberRole: null, teamId: null, teams: [] };
        }
    },
    lookupMemberRole: async (jiraName: string | null | undefined): Promise<string | null> => {
        const info = await jiraAuthService.lookupMemberInfo(jiraName);
        return info.memberRole;
    },
};
