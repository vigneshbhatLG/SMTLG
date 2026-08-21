import { createSlice } from '@reduxjs/toolkit';
import { getDodForLabels, isDefaultDod } from '../../utils/dodTemplates';

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Planning happens in three steps, tracked by `step`:
 *   'sprint'   — pick the target sprint (always first)
 *   'count'    — no stories in Jira yet, ask how many of each label to draft
 *   'table'    — edit the grid; rows with a `key` already exist in Jira
 */
const sprintPlanningSlice = createSlice({
  name: 'sprintPlanning',
  initialState: {
    stories: [],
    checkedIds: [],       // kept as plain array (Set not serialisable in Redux)
    selectedSprintId: '',
    projectKey: 'TVPLAT',
    epics: [],
    step: 'sprint',
  },
  reducers: {
    initStories(state, action) {
      // payload: { [label]: count }
      const labelCounts = action.payload;
      const stories = [];
      for (const [label, count] of Object.entries(labelCounts)) {
        for (let i = 0; i < Number(count); i++) {
          stories.push({ id: makeId(), key: null, summary: '', description: '', sp: 2, labels: [label], epic: '', dod: getDodForLabels([label]), dirty: false });
        }
      }
      state.stories = stories;
      state.checkedIds = stories.map((s) => s.id);
      state.step = 'table';
    },

    /** Seeds the grid from stories that already exist in the sprint. */
    loadExistingStories(state, action) {
      const stories = action.payload.map((s) => ({
        id: makeId(),
        key: s.key,
        summary: s.summary || '',
        description: s.description || '',
        sp: s.storyPoints ?? 0,
        labels: s.labels || [],
        epic: s.epic || '',
        dod: s.dod || '',
        status: s.status || '',
        dirty: false,
      }));
      state.stories = stories;
      state.checkedIds = stories.map((s) => s.id);
      state.step = 'table';
    },

    updateStory(state, action) {
      const { id, field, value } = action.payload;
      const story = state.stories.find((s) => s.id === id);
      if (!story) return;
      story[field] = value;
      // Re-seed the DoD when the label changes, unless the user has typed their own
      if (field === 'labels' && isDefaultDod(story.dod)) {
        story.dod = getDodForLabels(value);
      }
      // Existing tickets need an explicit update call; drafts are created wholesale
      if (story.key) story.dirty = true;
    },

    addStory(state) {
      const id = makeId();
      const labels = ['development'];
      state.stories.push({ id, key: null, summary: '', description: '', sp: 2, labels, epic: '', dod: getDodForLabels(labels), dirty: false });
      state.checkedIds.push(id);
    },

    removeStory(state, action) {
      state.stories = state.stories.filter((s) => s.id !== action.payload);
      state.checkedIds = state.checkedIds.filter((id) => id !== action.payload);
      // if all stories gone, let the count picker re-appear
      if (state.stories.length === 0) state.step = 'count';
    },

    toggleChecked(state, action) {
      const id = action.payload;
      const idx = state.checkedIds.indexOf(id);
      if (idx >= 0) state.checkedIds.splice(idx, 1);
      else state.checkedIds.push(id);
    },

    toggleAllChecked(state) {
      if (state.checkedIds.length > 0) state.checkedIds = [];
      else state.checkedIds = state.stories.map((s) => s.id);
    },

    setPlanningSprintId(state, action) {
      state.selectedSprintId = action.payload;
    },

    setPlanningProjectKey(state, action) {
      state.projectKey = action.payload;
    },

    setPlanningEpics(state, action) {
      state.epics = action.payload;
    },

    setPlanningStep(state, action) {
      state.step = action.payload;
    },

    /** Back to the sprint picker — the grid is rebuilt from whatever that sprint holds. */
    changeTargetSprint(state) {
      state.stories = [];
      state.checkedIds = [];
      state.step = 'sprint';
    },

    resetPlanning(state) {
      state.stories = [];
      state.checkedIds = [];
      state.step = 'count';
    },
  },
});

export const {
  initStories,
  loadExistingStories,
  updateStory,
  addStory,
  removeStory,
  toggleChecked,
  toggleAllChecked,
  setPlanningSprintId,
  setPlanningProjectKey,
  setPlanningEpics,
  setPlanningStep,
  changeTargetSprint,
  resetPlanning,
} = sprintPlanningSlice.actions;

export default sprintPlanningSlice.reducer;
