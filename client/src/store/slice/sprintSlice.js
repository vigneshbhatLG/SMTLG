import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getAuthHeaders } from '../../utils/api';

// Async thunk to fetch sprints from backend (all sprints across the domain, not team/board scoped)
export const fetchSprints = createAsyncThunk(
	'sprint/fetchSprints',
	async (_, { rejectWithValue }) => {
		try {
			const headers = getAuthHeaders();
			const res = await fetch(`/api/boards/sprints`, { headers });
			if (!res.ok) {
				throw new Error('Failed to fetch sprints');
			}
			const data = await res.json();
			// assuming backend returns { boardId, count, sprints: [...] }
			return data.sprints || [];
		} catch (err) {
			return rejectWithValue(err.message);
		}
	}
);

const sprintSlice = createSlice({
	name: 'sprint',
	initialState: {
		items: [],
		selectedSprintId: '',
		status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
		error: null
	},
	reducers: {
		setSelectedSprint(state, action) {
			state.selectedSprintId = action.payload;
		}
	},
	extraReducers: (builder) => {
		builder
			.addCase(fetchSprints.pending, (state) => {
				state.status = 'loading';
				state.error = null;
			})
			.addCase(fetchSprints.fulfilled, (state, action) => {
				state.status = 'succeeded';
				state.items = action.payload;
				// set default selected sprint if not set
				if (!state.selectedSprintId && state.items.length > 0) {
					state.selectedSprintId = String(state.items[0].id);
				}
			})
			.addCase(fetchSprints.rejected, (state, action) => {
				state.status = 'failed';
				state.error = action.payload || 'Failed to load sprints';
			});
	}
});

export const { setSelectedSprint } = sprintSlice.actions;
export default sprintSlice.reducer;
