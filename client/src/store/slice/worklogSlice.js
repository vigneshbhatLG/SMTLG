import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getAuthHeaders } from "../../utils/api";
import { fetchAssigneeIssues } from "../slice/issueSlice";

// Fetch worklogs + story points + estimates for a sprint
export const fetchSprintWorklogs = createAsyncThunk(
  "worklog/fetchSprintWorklogs",
  async (arg, { rejectWithValue }) => {
    try {
      const sprintId = typeof arg === 'object' && arg ? arg.sprintId : arg;
      const gerritFromDate = typeof arg === 'object' && arg ? arg.gerritFromDate : undefined;
      const gerritToDate = typeof arg === 'object' && arg ? arg.gerritToDate : undefined;
      const hardLoad = typeof arg === 'object' && arg ? !!arg.hardLoad : false;
      const teamId = typeof arg === 'object' && arg ? arg.teamId : undefined;

      const headers = getAuthHeaders();
      const qs = new URLSearchParams();
      // Important: do NOT pass fromDate/toDate here, because backend uses those for Jira `worklogDate` JQL filtering
      // which changes table totals (planned story points). Use separate params for Gerrit patch-range.
      if (gerritFromDate) qs.set('gerritFromDate', String(gerritFromDate));
      if (gerritToDate) qs.set('gerritToDate', String(gerritToDate));
      if (teamId != null) qs.set('teamId', String(teamId));
      if (hardLoad) qs.set('hardLoad', 'true');

      const url = `/api/sprints/${encodeURIComponent(sprintId)}/worklogs${qs.toString() ? `?${qs.toString()}` : ''}`;
      const res = await fetch(url, { headers });
      const data = await res.json();

      if (!res.ok) {
        return rejectWithValue(data.error || "Failed to load worklogs");
      }
      return data; // contains: { sprintId, jql, total, issues }
    } catch (err) {
      return rejectWithValue(err || "Network error");
    }
  }
);

// Fetch comments for an issue
export const fetchWorklogComments = createAsyncThunk(
  'worklog/fetchWorklogComments',
  async ({ issueId }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/worklog-comments`, { headers });
      const data = await res.json();
      if (!res.ok) {
        return rejectWithValue(data.error || 'Failed to load comments');
      }
      return { issueId, comments: data.comments || [] };
    } catch (err) {
      return rejectWithValue(err || 'Network error');
    }
  }
);

// Post a worklog
export const postWorklog = createAsyncThunk(
  'worklog/postWorklog',
  async ({ issueId, timeSpent, started, comment }, { dispatch, rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/worklog`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeSpent: timeSpent.trim(),
          started: started,
          comment: comment.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to post worklog');
      }

      const data = await response.json();

      return data;
    } catch (err) {
      return rejectWithValue(err.message);
    }
  }
);

// Fetch team patch counts from Gerrit
export const fetchTeamPatchCounts = createAsyncThunk(
  'worklog/fetchTeamPatchCounts',
  async ({ teamId, fromDate, toDate, projectPrefix }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const qs = new URLSearchParams();
      qs.set('from', fromDate);
      qs.set('to', toDate);
      if (projectPrefix) {
        qs.set('projectPrefix', projectPrefix);
      }

      const url = `/api/gerrit/team/${teamId}/patches/counts?${qs.toString()}`;
      const res = await fetch(url, { headers });
      const data = await res.json();

      if (!res.ok) {
        return rejectWithValue(data.error || 'Failed to fetch team patch counts');
      }

      return data; // contains: { teamId, from, to, counts, applications }
    } catch (err) {
      return rejectWithValue(err?.message || 'Network error');
    }
  }
);

// Fetch team TVPMs counts (Improvements)
export const fetchTeamTVPMsCounts = createAsyncThunk(
  'worklog/fetchTeamTVPMsCounts',
  async ({ teamId, fromDate, toDate }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const qs = new URLSearchParams();
      qs.set('from', fromDate);
      qs.set('to', toDate);

      const url = `/api/team/${teamId}/tvpms/counts?${qs.toString()}`;
      const res = await fetch(url, { headers });
      const data = await res.json();

      if (!res.ok) {
        return rejectWithValue(data.error || 'Failed to fetch team TVPMs counts');
      }

      return data; // contains: { teamId, from, to, counts }
    } catch (err) {
      return rejectWithValue(err?.message || 'Network error');
    }
  }
);

const worklogSlice = createSlice({
  name: "worklog",
  initialState: {
    worklogs: [],
    jql: "",
    patchCountsByMember: {},
    commentsByIssue: {},
    updated: null,
    status: "idle", // "idle" | "loading" | "succeeded" | "failed"
    error: null,
    teamPatchData: {
      counts: {},
      applications: [],
      status: "idle",
      error: null,
      fromDate: "",
      toDate: ""
    },
    teamTVPMsData: {
      counts: {},
      status: "idle",
      error: null,
      fromDate: "",
      toDate: ""
    }
  },
  reducers: {
    resetWorklogs(state) {
      state.sprintId = null;
      state.worklogs = [];
      state.total = 0;
      state.jql = "";
      state.status = "idle";
      state.error = null;
    },
    setPatchDateFilters(state, action) {
      state.teamPatchData.fromDate = action.payload.fromDate || "";
      state.teamPatchData.toDate = action.payload.toDate || "";
    },
    setTVPMsDateFilters(state, action) {
      state.teamTVPMsData.fromDate = action.payload.fromDate || "";
      state.teamTVPMsData.toDate = action.payload.toDate || "";
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSprintWorklogs.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchSprintWorklogs.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.worklogs = action.payload.data;
        state.jql = action.payload.jql;
        state.patchCountsByMember = action.payload.patchCountsByMember || {};
        state.updated = action.payload.updated || null;
      })
      .addCase(fetchSprintWorklogs.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to fetch sprint worklogs";
      });

    builder
      .addCase(fetchWorklogComments.pending, () => {})
      .addCase(fetchWorklogComments.fulfilled, (state, action) => {
        const { issueId, comments } = action.payload;
        state.commentsByIssue = { ...(state.commentsByIssue || {}), [issueId]: comments };
      })
      .addCase(fetchWorklogComments.rejected, () => {});

    builder
      .addCase(fetchTeamPatchCounts.pending, (state) => {
        state.teamPatchData.status = "loading";
        state.teamPatchData.error = null;
      })
      .addCase(fetchTeamPatchCounts.fulfilled, (state, action) => {
        state.teamPatchData.status = "succeeded";
        state.teamPatchData.counts = action.payload.counts || {};
        state.teamPatchData.applications = action.payload.applications || [];
      })
      .addCase(fetchTeamPatchCounts.rejected, (state, action) => {
        state.teamPatchData.status = "failed";
        state.teamPatchData.error = action.payload || "Failed to fetch team patch counts";
      });

    builder
      .addCase(fetchTeamTVPMsCounts.pending, (state) => {
        state.teamTVPMsData.status = "loading";
        state.teamTVPMsData.error = null;
      })
      .addCase(fetchTeamTVPMsCounts.fulfilled, (state, action) => {
        state.teamTVPMsData.status = "succeeded";
        state.teamTVPMsData.counts = action.payload.counts || {};
      })
      .addCase(fetchTeamTVPMsCounts.rejected, (state, action) => {
        state.teamTVPMsData.status = "failed";
        state.teamTVPMsData.error = action.payload || "Failed to fetch team TVPMs counts";
      });
  }
});

export const { resetWorklogs, setPatchDateFilters, setTVPMsDateFilters } = worklogSlice.actions;
export default worklogSlice.reducer;
