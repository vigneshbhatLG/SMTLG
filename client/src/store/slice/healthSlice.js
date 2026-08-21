import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

export const fetchHealthSnapshots = createAsyncThunk(
    'health/fetchSnapshots',
    async ({ from, to }, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (to) params.set('to', to);
            const res = await axios.get(`/api/health/snapshots?${params}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data.snapshots;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchOpenIssues = createAsyncThunk(
    'health/fetchOpenIssues',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.get('/api/health/open-issues', {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data.issues;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchMemberStats = createAsyncThunk(
    'health/fetchMemberStats',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.get('/api/health/member-stats', {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchMttrSamples = createAsyncThunk(
    'health/fetchMttrSamples',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.get('/api/health/mttr-samples', {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data.samples;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchReopenEvents = createAsyncThunk(
    'health/fetchReopenEvents',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.get('/api/health/reopen-events', {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data.events;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchSprintCohorts = createAsyncThunk(
    'health/fetchSprintCohorts',
    async (sprints, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.post('/api/health/sprint-cohorts', { sprints }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data.rows;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const fetchSprintMemberLoad = createAsyncThunk(
    'health/fetchSprintMemberLoad',
    async ({ id, start, end }, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const params = new URLSearchParams({ start, end });
            const res = await axios.get(`/api/health/sprint-member-load?${params}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return { id, ...res.data };
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const deleteSnapshots = createAsyncThunk(
    'health/deleteSnapshots',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.delete('/api/health/snapshots', {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

export const triggerBackfill = createAsyncThunk(
    'health/backfill',
    async (_, { getState, rejectWithValue }) => {
        try {
            const token = getState().auth.token;
            const res = await axios.post('/api/health/backfill', {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return res.data;
        } catch (e) {
            return rejectWithValue(e.response?.data?.error || e.message);
        }
    }
);

const healthSlice = createSlice({
    name: 'health',
    initialState: {
        snapshots: [],
        snapshotsStatus: 'idle',
        snapshotsError: null,
        openIssues: [],
        openIssuesStatus: 'idle',
        openIssuesError: null,
        backfillStatus: 'idle',
        backfillResult: null,
        memberStats: [],
        memberStatsMeta: null,
        memberStatsStatus: 'idle',
        memberStatsError: null,
        mttrSamples: [],
        mttrStatus: 'idle',
        mttrError: null,
        reopenEvents: [],
        reopenStatus: 'idle',
        reopenError: null,
        sprintCohorts: [],
        sprintCohortsStatus: 'idle',
        sprintCohortsError: null,
        sprintLoad: null,
        sprintLoadStatus: 'idle',
        sprintLoadError: null,
    },
    reducers: {
        resetBackfill(state) {
            state.backfillStatus = 'idle';
            state.backfillResult = null;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchHealthSnapshots.pending, (state) => {
                state.snapshotsStatus = 'loading';
                state.snapshotsError = null;
            })
            .addCase(fetchHealthSnapshots.fulfilled, (state, action) => {
                state.snapshotsStatus = 'succeeded';
                state.snapshots = action.payload;
            })
            .addCase(fetchHealthSnapshots.rejected, (state, action) => {
                state.snapshotsStatus = 'failed';
                state.snapshotsError = action.payload;
            })
            .addCase(fetchOpenIssues.pending, (state) => {
                state.openIssuesStatus = 'loading';
                state.openIssuesError = null;
            })
            .addCase(fetchOpenIssues.fulfilled, (state, action) => {
                state.openIssuesStatus = 'succeeded';
                state.openIssues = action.payload;
            })
            .addCase(fetchOpenIssues.rejected, (state, action) => {
                state.openIssuesStatus = 'failed';
                state.openIssuesError = action.payload;
            })
            .addCase(fetchMemberStats.pending, (state) => {
                state.memberStatsStatus = 'loading';
                state.memberStatsError = null;
            })
            .addCase(fetchMemberStats.fulfilled, (state, action) => {
                state.memberStatsStatus = 'succeeded';
                state.memberStats = action.payload?.members || [];
                state.memberStatsMeta = {
                    generatedAt: action.payload?.generatedAt,
                    windowDays: action.payload?.windowDays,
                };
            })
            .addCase(fetchMemberStats.rejected, (state, action) => {
                state.memberStatsStatus = 'failed';
                state.memberStatsError = action.payload;
            })
            .addCase(fetchMttrSamples.pending, (state) => {
                state.mttrStatus = 'loading';
                state.mttrError = null;
            })
            .addCase(fetchMttrSamples.fulfilled, (state, action) => {
                state.mttrStatus = 'succeeded';
                state.mttrSamples = action.payload || [];
            })
            .addCase(fetchMttrSamples.rejected, (state, action) => {
                state.mttrStatus = 'failed';
                state.mttrError = action.payload;
            })
            .addCase(fetchReopenEvents.pending, (state) => {
                state.reopenStatus = 'loading';
                state.reopenError = null;
            })
            .addCase(fetchReopenEvents.fulfilled, (state, action) => {
                state.reopenStatus = 'succeeded';
                state.reopenEvents = action.payload || [];
            })
            .addCase(fetchReopenEvents.rejected, (state, action) => {
                state.reopenStatus = 'failed';
                state.reopenError = action.payload;
            })
            .addCase(fetchSprintCohorts.pending, (state) => {
                state.sprintCohortsStatus = 'loading';
                state.sprintCohortsError = null;
            })
            .addCase(fetchSprintCohorts.fulfilled, (state, action) => {
                state.sprintCohortsStatus = 'succeeded';
                state.sprintCohorts = action.payload || [];
            })
            .addCase(fetchSprintCohorts.rejected, (state, action) => {
                state.sprintCohortsStatus = 'failed';
                state.sprintCohortsError = action.payload;
            })
            .addCase(fetchSprintMemberLoad.pending, (state) => {
                state.sprintLoadStatus = 'loading';
                state.sprintLoadError = null;
            })
            .addCase(fetchSprintMemberLoad.fulfilled, (state, action) => {
                state.sprintLoadStatus = 'succeeded';
                state.sprintLoad = action.payload;
            })
            .addCase(fetchSprintMemberLoad.rejected, (state, action) => {
                state.sprintLoadStatus = 'failed';
                state.sprintLoadError = action.payload;
            })
            .addCase(triggerBackfill.pending, (state) => {
                state.backfillStatus = 'loading';
            })
            .addCase(triggerBackfill.fulfilled, (state, action) => {
                state.backfillStatus = 'succeeded';
                state.backfillResult = action.payload;
            })
            .addCase(triggerBackfill.rejected, (state, action) => {
                state.backfillStatus = 'failed';
                state.backfillResult = { error: action.payload };
            });
    }
});

export const { resetBackfill } = healthSlice.actions;
export default healthSlice.reducer;
