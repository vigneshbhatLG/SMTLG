import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getAuthHeaders } from "../../utils/api";

export const fetchWorkItems = createAsyncThunk(
    "workItems/fetchWorkItems",
    async ({ boardId, issueTypes, issueStatuses, assignee }, { rejectWithValue }) => {
        try {
            const headers = getAuthHeaders();

            // Build query parameters
            const params = new URLSearchParams();
            params.append("boardId", String(boardId));

            if (issueTypes && issueTypes.length > 0) {
                params.append("issueTypes", issueTypes.join(","));
            }

            if (issueStatuses && issueStatuses.length > 0) {
                params.append("issueStatuses", issueStatuses.join(","));
            }

            if (assignee) {
                params.append("assignee", assignee);
            }

            const url = `/api/work-items/filters?${params.toString()}`;
            const res = await fetch(url, { headers });
            const data = await res.json();

            if (!res.ok) {
                return rejectWithValue(data.error || "Failed to load work items");
            }

            return data;
        } catch (err) {
            return rejectWithValue(err instanceof Error ? err.message : "Network error");
        }
    },
);

const initialState = {
    items: [],
    status: "idle",
    error: null,
    filters: {
        boardId: null,
        issueTypes: [],
        issueStatuses: [],
        selectedAssignee: "",
        assignee: null,
    },

    refresh: true,
};

const workItemSlice = createSlice({
    name: "workItems",
    initialState,
    reducers: {
        setFilters(state, action) {
            if (action.payload.issueTypes !== undefined) {
                state.filters.issueTypes = action.payload.issueTypes;
            }
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
            .addCase(fetchWorkItems.pending, (state) => {
                state.status = "loading";
                state.error = null;
            })
            .addCase(fetchWorkItems.fulfilled, (state, action) => {
                state.status = "succeeded";
                state.items = action.payload.issues || [];
                state.bugCountByUser = action.payload.bugCountByUser || {};
                state.error = null;
                state.refresh = false;
            })
            .addCase(fetchWorkItems.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.payload;
                state.refresh = false;
            });
    },
});

export const { setFilters, clearWorkItems, setRefresh } = workItemSlice.actions;
export default workItemSlice.reducer;
