import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getAuthHeaders } from '../../utils/api';

export const loginUser = createAsyncThunk(
	"auth/loginUser",
	async (token, { rejectWithValue }) => {
		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token })
			});

			const data = await res.json();

			if (!res.ok) {
				return rejectWithValue(data.error || "Login failed");
			}

			// Server returns encrypted token (base64). Use that instead of raw PAT.
			return {
				token: data.token,
				user: data.user,
				teams: data.teams
			};
		} catch (err) {
			console.error("loginUser network error:", err);
			return rejectWithValue("Network error");
		}
	}
);

export const fetchCurrentUser = createAsyncThunk(
	'auth/fetchCurrentUser',
	async (_, { rejectWithValue }) => {
		try {
			const headers = getAuthHeaders();
			const res = await fetch('/api/auth/me', { headers });
			if (!res.ok) {
				const text = await res.text();
				return rejectWithValue(text || 'Failed to fetch current user');
			}
			const data = await res.json();
			return data;
		} catch (err) {
			console.error('fetchCurrentUser network error:', err);
			return rejectWithValue('Network error');
		}
	}
);

export const fetchTeamList = createAsyncThunk(
	'auth/fetchTeamList',
	async (_, { rejectWithValue }) => {
		try {
			const headers = getAuthHeaders();
			const res = await fetch('/api/boards/list', { headers });
			if (!res.ok) {
				const text = await res.text();
				return rejectWithValue(text || 'Failed to fetch team list');
			}
			const data = await res.json();
			// Transform boards to teams format
			const teams = (data.boards || []).map((board) => ({
				teamId: board.teamId,
				teamName: board.teamName
			}));
			return teams;
		} catch (err) {
			console.error('fetchTeamList network error:', err);
			return rejectWithValue('Network error');
		}
	}
);

const authSlice = createSlice({
	name: "auth",
	initialState: {
		isAuthenticated: false,
		token: "",
		user: null,
		teams: [],
		selectedTeamId: null,
		status: "idle",
		error: null
	},
	reducers: {
		logout(state) {
			state.isAuthenticated = false;
			state.token = "";
			state.user = null;
			state.status = "idle";
			// Remove persisted token on logout
			try {
				sessionStorage.removeItem("auth_token");
				sessionStorage.removeItem("gerrit_token");
				// Backward-compat cleanup
				sessionStorage.removeItem("gerrit_connected");
			} catch {
				// Ignore sessionStorage errors
			}
		}
		,setAuth(state, action) {
			// payload should be the encrypted token string
			state.isAuthenticated = true;
			state.token = action.payload || "";
		}
		,setUser(state, action) {
			state.user = action.payload || null;
		},
		setGerritConnected(state, action) {
			if (state.user) {
				state.user.gerritConnected = action.payload;
			}
		},
		setSelectedBoard(state, action) {
			if (state.user) {
				state.user.teamId = action.payload;
			}
		},
		setTeams(state, action) {
			state.teams = action.payload || [];
		},
		setSelectedTeamId(state, action) {
			state.selectedTeamId = action.payload;
		}
	},
	extraReducers: (builder) => {
		builder
			.addCase(loginUser.pending, (state) => {
				state.status = "loading";
				state.error = null;
			})
			.addCase(fetchCurrentUser.pending, () => {})
			.addCase(fetchCurrentUser.fulfilled, (state, action) => {
				state.user = action.payload || null;
				const isGerrit = !!(sessionStorage.getItem('gerrit_token') || '').trim();
				if (state.user) {
					state.user.gerritConnected = isGerrit;
					// Ensure teamId from the /me response is saved on the user object
					state.user.teamId = action.payload && action.payload.teamId
					console.log("Fetched current user with teamId:", state.user.teamId);
					// Set selectedTeamId from user's teamId
					state.selectedTeamId = state.user.teamId;
				}
				// Save teams from response
				if (action.payload && action.payload.teams) {
					state.teams = action.payload.teams;
				}
			})
			.addCase(fetchCurrentUser.rejected, () => {})
			.addCase(loginUser.fulfilled, (state, action) => {
				state.status = "succeeded";
				state.isAuthenticated = true;
				state.token = action.payload.token;
				state.user = action.payload.user || null;
				if (state.user) {
					state.user.teamId = action.payload.user?.teamId != null ? action.payload.user.teamId : (state.user.teamId ?? null);
					// Set default selected team to user's teamId
					console.log("Setting selectedTeamId to:", state.user.teamId);
					state.selectedTeamId = state.user.teamId;
				}
				// Save teams from login response
				if (action.payload.teams) {
					state.teams = action.payload.teams;
				}
				// Normalize gerritConnected to a boolean to avoid undefined->false transitions
				try {
					const hasGerritToken = !!(sessionStorage.getItem('gerrit_token') || '').trim();
					if (state.user) state.user.gerritConnected = hasGerritToken;
				} catch {
					if (state.user) state.user.gerritConnected = false;
				}
				// Persist token returned by server (already encrypted)
				try {
					sessionStorage.setItem("auth_token", action.payload.token);
				} catch (e) {
					// Ignore sessionStorage errors
				}
			})
			.addCase(loginUser.rejected, (state, action) => {
				state.status = "failed";
				state.error = action.payload || "Invalid token";
			})
			.addCase(fetchTeamList.fulfilled, (state, action) => {
				state.teams = action.payload || [];
			})
			.addCase(fetchTeamList.rejected, () => {});
	}
});

export const { logout, setAuth, setGerritConnected, setSelectedBoard, setTeams, setSelectedTeamId } = authSlice.actions;
export default authSlice.reducer;
