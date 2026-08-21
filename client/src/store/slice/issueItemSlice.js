import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getAuthHeaders } from "../../utils/api";

export const fetchIssueItems = createAsyncThunk("issueItems/fetchIssueItems", async ({ teamId, issueStatuses, assignee }, { rejectWithValue }) => {
    try {
        const headers = getAuthHeaders();

        // Build query parameters
        const params = new URLSearchParams();
        if (teamId != null) {
            params.append("teamId", String(teamId));
        }

        if (issueStatuses && issueStatuses.length > 0) {
            params.append("issueStatuses", issueStatuses.join(","));
        }

        if (assignee) {
            params.append("assignee", assignee);
        }

        const url = `/api/issue-items/filters?${params.toString()}`;
        const res = await fetch(url, { headers });
        const data = await res.json();

        if (!res.ok) {
            return rejectWithValue(data.error || "Failed to load issue items");
        }

        return data;
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : "Network error");
    }
});

const initialState = {
    items: [],
    bugCountByUser: {},
    status: "idle",
    error: null,
    filters: {
        boardId: null,
        issueStatuses: [],
        selectedAssignee: "",
        assignee: null,
    },
    refresh: true,
};

const issueItemSlice = createSlice({
    name: "workItems",
    initialState,
    reducers: {
        setFilters(state, action) {
            if (action.payload.issueStatuses !== undefined) {
                state.filters.issueStatuses = action.payload.issueStatuses;
            }
            if (action.payload.selectedAssignee !== undefined) {
                state.filters.selectedAssignee = action.payload.selectedAssignee;
            }
            if (action.payload.boardId !== undefined) {
                state.filters.boardId = action.payload.boardId;
            }
            if (action.payload.assignee !== undefined) {
                state.filters.assignee = action.payload.assignee;
            }
        },
        clearWorkItems(state) {
            state.items = [];
            state.error = null;
        },
        setRefresh(state) {
            state.refresh = true;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchIssueItems.pending, (state) => {
                state.status = "loading";
                state.error = null;
            })
            .addCase(fetchIssueItems.fulfilled, (state, action) => {
                state.status = "succeeded";
                state.items = action.payload.issues || [];
                state.bugCountByUser = action.payload.bugCountByUser || {};
                state.error = null;
                state.refresh = false;
            })
            .addCase(fetchIssueItems.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.payload;
                state.refresh = false;
            });
    },
});

export const { setFilters, clearWorkItems, setRefresh } = issueItemSlice.actions;
export default issueItemSlice.reducer;
