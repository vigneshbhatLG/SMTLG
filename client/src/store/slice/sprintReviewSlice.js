import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getAuthHeaders } from "../../utils/api";

// Fetch resolved issues for sprint review
export const fetchResolvedIssues = createAsyncThunk(
  "sprintReview/fetchResolvedIssues",
  async ({ startDate, endDate, teamId, hardReload }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const response = await fetch('/api/review/resolved-issues', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          ...(teamId != null && { teamId }),
          hardReload
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        return rejectWithValue(data.error || 'Failed to fetch resolved issues');
      }

      const data = await response.json();
      return data; // contains: { ok, memberIssueCounts, total, jql }
    } catch (err) {
      return rejectWithValue(err?.message || 'Network error');
    }
  }
);

// Fetch issue transfers for sprint review
export const fetchIssueTransfers = createAsyncThunk(
  "sprintReview/fetchIssueTransfers",
  async ({ startDate, endDate, teamId, hardReload }, { rejectWithValue }) => {
    try {
      const headers = getAuthHeaders();
      const response = await fetch('/api/review/issue-transfers', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          ...(teamId != null && { teamId }),
          hardReload
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        return rejectWithValue(data.error || 'Failed to fetch issue transfers');
      }

      const data = await response.json();
      return data; // contains: { ok, memberIssueCounts, total, jql }
    } catch (err) {
      return rejectWithValue(err?.message || 'Network error');
    }
  }
);

const sprintReviewSlice = createSlice({
  name: 'sprintReview',
  initialState: {
    issues: [],
    total: 0,
    jql: '',
    memberMetrics: {}, // { member: { member, numberOfIssues, mttr } }
    status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    error: null,
    startDate: null,
    endDate: null,
    // Issue transfers state
    issueTransfers: [],
    transfersTotal: 0,
    transfersJql: '',
    transfersStatus: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    transfersError: null,
  },
  reducers: {
    clearResolvedIssues(state) {
      state.issues = [];
      state.total = 0;
      state.jql = '';
      state.memberMetrics = {};
      state.error = null;
      state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchResolvedIssues.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchResolvedIssues.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.issues = action.payload.issues || [];
        state.total = action.payload.total || 0;
        state.jql = action.payload.jql || '';
        state.startDate = action.payload.startDate;
        state.endDate = action.payload.endDate;
        state.memberMetrics = action.payload.memberIssueCounts || [];
      })
      .addCase(fetchResolvedIssues.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || 'Failed to load resolved issues';
      })
      .addCase(fetchIssueTransfers.pending, (state) => {
        state.transfersStatus = 'loading';
        state.transfersError = null;
      })
      .addCase(fetchIssueTransfers.fulfilled, (state, action) => {
        state.transfersStatus = 'succeeded';
        state.issueTransfers = action.payload.memberIssueCounts || [];
        state.transfersTotal = action.payload.total || 0;
        state.transfersJql = action.payload.jql || '';
      })
      .addCase(fetchIssueTransfers.rejected, (state, action) => {
        state.transfersStatus = 'failed';
        state.transfersError = action.payload || 'Failed to load issue transfers';
      });
  },
});

export const { clearResolvedIssues } = sprintReviewSlice.actions;
export default sprintReviewSlice.reducer;
