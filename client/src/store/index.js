import { configureStore } from '@reduxjs/toolkit';

// Slices
import sprintReducer from './slice/sprintSlice';
import authReducer from './slice/authSlice';
import worklogReducer from './slice/worklogSlice';
import issueReducer from './slice/issueSlice';
import kpiReducer from './slice/kpiSlice';
import workItemReducer from './slice/workItemSlice';
import issueItemReducer from './slice/issueItemSlice';
import aiAnalysisReducer from './slice/aiAnalysisSlice';
import sprintReviewReducer from './slice/sprintReviewSlice';
import sprintPlanningReducer from './slice/sprintPlanningSlice';
import healthReducer from './slice/healthSlice';

export const store = configureStore({
	reducer: {
		sprint: sprintReducer,
		auth: authReducer,
		worklog: worklogReducer,
		issue: issueReducer,
		kpi: kpiReducer,
		workItems: workItemReducer,
		issueItems: issueItemReducer,
		aiAnalysis: aiAnalysisReducer,
		sprintReview: sprintReviewReducer,
		sprintPlanning: sprintPlanningReducer,
		health: healthReducer,
	}
});