import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Streaming bulk analysis — only analyzes issues currently shown in open issues table
// ticketIds: array of issue keys to analyze
export const fetchAIAnalysis = (ticketIds = []) => async (dispatch) => {
    dispatch({ type: 'aiAnalysis/streamStart' });

    try {
        const response = await fetch('/api/issues/ai-analysis-bulk-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketIds }),
        });

        if (!response.ok) throw new Error('Failed to start AI analysis stream');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.slice(6));
                    if (event.complete) {
                        dispatch({ type: 'aiAnalysis/streamComplete' });
                    } else {
                        dispatch({ type: 'aiAnalysis/streamProgress', payload: event });
                    }
                } catch {
                    // ignore malformed SSE line
                }
            }
        }
    } catch (error) {
        dispatch({ type: 'aiAnalysis/streamError', payload: error.message });
    }
};

// Load previously saved analysis results from MongoDB for given ticketIds
export const loadSavedAnalysis = createAsyncThunk(
    'aiAnalysis/loadSaved',
    async (ticketIds, { rejectWithValue }) => {
        try {
            const response = await fetch('/api/issues/ai-analysis-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketIds }),
            });
            if (!response.ok) throw new Error('Failed to load saved analysis');
            return await response.json();
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// API call to analyze a single issue
export const analyzeIssue = createAsyncThunk(
    'aiAnalysis/analyzeIssue',
    async (ticketId, { rejectWithValue }) => {
        try {
            const response = await fetch('/api/issues/ai-analysis', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ticketId })
            });

            if (!response.ok) {
                throw new Error('Failed to analyze issue');
            }

            const result = await response.json();
            return { ticketId, ...result };
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const initialState = {
    analysisData: [],
    loading: false,
    issueAnalysisLoading: false,
    error: null,
    completed: false,
    streamDone: 0,
    streamTotal: 0,
};

const aiAnalysisSlice = createSlice({
    name: 'aiAnalysis',
    initialState,
    reducers: {
        resetAIAnalysis: (state) => {
            state.analysisData = [];
            state.loading = false;
            state.issueAnalysisLoading = false;
            state.error = null;
            state.completed = false;
            state.streamDone = 0;
            state.streamTotal = 0;
        },
        streamStart: (state) => {
            state.loading = true;
            state.error = null;
            state.completed = false;
            state.streamDone = 0;
            state.streamTotal = 0;
        },
        streamProgress: (state, action) => {
            const { done, total, result } = action.payload;
            state.streamDone = done;
            state.streamTotal = total;
            if (result) {
                const ticketId = result['Issue ID'];
                const idx = state.analysisData.findIndex(i => i.ticketId === ticketId);
                if (idx >= 0) {
                    state.analysisData[idx] = { ticketId, analysisResult: result };
                } else {
                    state.analysisData.push({ ticketId, analysisResult: result });
                }
            }
        },
        streamComplete: (state) => {
            state.loading = false;
            state.completed = true;
        },
        streamError: (state, action) => {
            state.loading = false;
            state.error = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(analyzeIssue.pending, (state) => {
                state.issueAnalysisLoading = true;
                state.error = null;
            })
            .addCase(analyzeIssue.fulfilled, (state, action) => {
                state.issueAnalysisLoading = false;
                const { ticketId, ...analysisResult } = action.payload;
                // Find and update existing analysis or add new one
                const existingIndex = state.analysisData.findIndex(item => item.ticketId === ticketId);
                if (existingIndex >= 0) {
                    state.analysisData[existingIndex] = { ticketId, analysisResult };
                } else {
                    state.analysisData.push({ ticketId, analysisResult });
                }
            })
            .addCase(analyzeIssue.rejected, (state, action) => {
                state.issueAnalysisLoading = false;
                state.error = action.payload;
            })
            .addCase(loadSavedAnalysis.fulfilled, (state, action) => {
                // Merge saved results into analysisData without overwriting in-progress data
                for (const item of (action.payload || [])) {
                    const idx = state.analysisData.findIndex(i => i.ticketId === item.ticketId);
                    if (idx >= 0) {
                        state.analysisData[idx] = item;
                    } else {
                        state.analysisData.push(item);
                    }
                }
            });
    }
});

export const { resetAIAnalysis, streamStart, streamProgress, streamComplete, streamError } = aiAnalysisSlice.actions;
export default aiAnalysisSlice.reducer;
