import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getAuthHeaders } from '../utils/api';
import {
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
} from '../store/slice/sprintPlanningSlice';
import './css/SprintPlanningView.css';

const PRESET_LABELS = ['development', 'issue', 'operation', 'training', 'planned_leave'];

const JIRA_BROWSE_URL = 'http://jira.lge.com/issue/browse';

const LABEL_DISPLAY = {
  development:   'Development',
  issue:         'Issue',
  operation:     'Operation',
  training:      'Training',
  planned_leave: 'Planned Leave',
};

/* ── Count-picker modal ─────────────────────────────────────────── */
function CountPickerModal({ onConfirm, sprintName, onBack }) {
  const [counts, setCounts] = useState(
    Object.fromEntries(PRESET_LABELS.map((l) => [l, 0]))
  );

  const adjust = (label, delta) =>
    setCounts((prev) => ({ ...prev, [label]: Math.max(0, prev[label] + delta) }));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="sp-modal-backdrop">
      <div className="sp-modal">
        <h3 className="sp-modal-title">Plan Your Sprint</h3>
        <p className="sp-modal-sub">
          {sprintName
            ? <>No stories found in <strong>{sprintName}</strong> yet. Set how many to create for each label.</>
            : 'Set the number of stories to create for each label'}
        </p>

        <div className="sp-modal-rows">
          {PRESET_LABELS.map((label) => (
            <div key={label} className="sp-modal-row">
              <span className="sp-modal-label">{LABEL_DISPLAY[label]}</span>
              <div className="sp-counter">
                <button
                  className="sp-counter-btn"
                  onClick={() => adjust(label, -1)}
                  disabled={counts[label] === 0}
                  aria-label={`Decrease ${label}`}
                >
                  −
                </button>
                <span className="sp-counter-val">{counts[label]}</span>
                <button
                  className="sp-counter-btn"
                  onClick={() => adjust(label, 1)}
                  aria-label={`Increase ${label}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sp-modal-footer">
          <span className="sp-modal-total">
            {onBack && <button className="sp-target-change" onClick={onBack}>← Sprint</button>}
            {' '}Total: <strong>{total}</strong> {total === 1 ? 'story' : 'stories'}
          </span>
          <button
            className="sp-btn-post"
            disabled={total === 0}
            onClick={() => onConfirm(counts)}
          >
            Start Planning
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The sprint to plan into by default: the immediate upcoming one — the
 * future sprint that starts soonest. Jira often leaves `startDate` unset on
 * future sprints, in which case board order (already chronological) decides.
 * Falls back to the active sprint when nothing future exists.
 */
function pickUpcomingSprint(sprints) {
  const future = sprints.filter((s) => s.state === 'future');
  if (future.length > 0) {
    const dated = future.filter((s) => s.startDate);
    if (dated.length > 0) {
      return dated.reduce((a, b) => (new Date(a.startDate) <= new Date(b.startDate) ? a : b));
    }
    return future[0];
  }
  return sprints.find((s) => s.state === 'active') || null;
}

const sprintPrefix = (state) => (state === 'active' ? '▶ ' : state === 'future' ? '◆ ' : '');

/* ── Blocking overlay ───────────────────────────────────────────── */
function BlockingLoader({ message, sub }) {
  // Covers the whole viewport so nothing can be clicked or typed while Jira works
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  return (
    <div className="sp-blocker" role="alertdialog" aria-busy="true" aria-live="assertive">
      <div className="sp-blocker-box">
        <div className="sp-blocker-spinner" />
        <div className="sp-blocker-msg">{message}</div>
        {sub && <div className="sp-blocker-sub">{sub}</div>}
      </div>
    </div>
  );
}

/* ── Step 1: target sprint picker ───────────────────────────────── */
function SprintSelectModal({ sprints, defaultSprintId, loading, error, onStart }) {
  // `picked` stays null until the user chooses, so the default can keep
  // resolving as the sprint list loads in
  const [picked, setPicked] = useState(null);
  const sprintId = picked ?? defaultSprintId ?? '';

  const sprint = sprints.find((s) => String(s.id) === String(sprintId));

  return (
    <div className="sp-modal-backdrop">
      <div className="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-target-title">
        <h3 className="sp-modal-title" id="sp-target-title">Select target sprint</h3>
        <p className="sp-modal-sub">
          Pick the sprint you're planning for. We'll load your existing stories from Jira if there are any.
        </p>

        <label className="sp-label" htmlFor="sp-target-sprint">Target Sprint</label>
        <div className="sp-select-wrap sp-confirm-select">
          <select
            id="sp-target-sprint"
            className="sp-select"
            value={sprintId}
            autoFocus
            disabled={sprints.length === 0}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">{sprints.length === 0 ? 'Loading sprints…' : '— Select sprint —'}</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{sprintPrefix(s.state)}{s.name}</option>
            ))}
          </select>
          <span className="sp-caret">▾</span>
        </div>

        {sprint && (
          <p className="sp-confirm-note">
            {sprint.state === 'future' && 'Upcoming sprint'}
            {sprint.state === 'active' && 'Currently active sprint'}
            {sprint.state === 'closed' && 'This sprint is already closed.'}
          </p>
        )}

        {error && (
          <p className="sp-confirm-note sp-confirm-note--error">
            {error}. Try again, or pick another sprint.
          </p>
        )}

        <div className="sp-modal-footer">
          <span className="sp-modal-total">{sprints.length} {sprints.length === 1 ? 'sprint' : 'sprints'} available</span>
          <button className="sp-btn-post" disabled={!sprintId || loading} onClick={() => onStart(String(sprintId))}>
            {loading ? 'Loading…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Post confirmation modal ────────────────────────────────────── */
function ConfirmPostModal({ sprints, defaultSprintId, newCount, editCount, totalSP, projectKey, onConfirm, onCancel }) {
  const [sprintId, setSprintId] = useState(defaultSprintId);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sprint = sprints.find((s) => String(s.id) === String(sprintId));
  const changed = String(sprintId) !== String(defaultSprintId);

  return (
    <div className="sp-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-confirm-title">
        <h3 className="sp-modal-title" id="sp-confirm-title">Confirm target sprint</h3>
        <p className="sp-modal-sub">
          {newCount > 0 && (
            <>
              <strong>{newCount}</strong> new {newCount === 1 ? 'story' : 'stories'} will be created in{' '}
              <strong>{projectKey}</strong>
            </>
          )}
          {newCount > 0 && editCount > 0 && ' and '}
          {editCount > 0 && (
            <><strong>{editCount}</strong> existing {editCount === 1 ? 'ticket' : 'tickets'} will be updated</>
          )}
          {' '}({totalSP} SP selected). Check the sprint below — stories can't be un-created.
        </p>

        <label className="sp-label" htmlFor="sp-confirm-sprint">Target Sprint</label>
        <div className="sp-select-wrap sp-confirm-select">
          <select
            id="sp-confirm-sprint"
            className="sp-select"
            value={sprintId}
            autoFocus
            onChange={(e) => setSprintId(e.target.value)}
          >
            <option value="">— Select sprint —</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>{sprintPrefix(s.state)}{s.name}</option>
            ))}
          </select>
          <span className="sp-caret">▾</span>
        </div>

        {sprint && (
          <p className={`sp-confirm-note${changed ? ' sp-confirm-note--changed' : ''}`}>
            Summaries will be prefixed with “{sprint.name}”
            {sprint.state === 'closed' && ' — heads up, this sprint is already closed.'}
          </p>
        )}

        <div className="sp-modal-footer">
          <button className="sp-btn-reset" onClick={onCancel}>Cancel</button>
          <button className="sp-btn-post" disabled={!sprintId} onClick={() => onConfirm(String(sprintId))}>
            Confirm &amp; Post
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Label cell ─────────────────────────────────────────────────── */
const LabelCell = React.memo(function LabelCell({ labels, onChange }) {
  const [customMode, setCustomMode] = useState(false);
  const [customVal, setCustomVal] = useState('');

  const available = PRESET_LABELS.filter((l) => !labels.includes(l));

  const add = (lbl) => {
    const v = lbl.trim();
    if (v && !labels.includes(v)) onChange([...labels, v]);
  };

  const remove = (lbl) => onChange(labels.filter((l) => l !== lbl));

  const commitCustom = () => {
    const v = customVal.trim().replace(/\s+/g, '_');
    if (v) add(v);
    setCustomVal('');
    setCustomMode(false);
  };

  return (
    <div className="sp-label-cell">
      {labels.length > 0 && (
        <div className="sp-chips">
          {labels.map((l) => (
            <span key={l} className="sp-chip">
              {l}
              <button className="sp-chip-rm" onClick={() => remove(l)} title={`Remove "${l}"`} aria-label={`Remove ${l}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {customMode ? (
        <div className="sp-custom-label">
          <input
            className="sp-custom-input"
            autoFocus
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustom();
              if (e.key === 'Escape') { setCustomMode(false); setCustomVal(''); }
            }}
            placeholder="Label name, Enter to confirm"
          />
          <button className="sp-custom-ok" onClick={commitCustom} title="Confirm">✓</button>
          <button className="sp-custom-cancel" onClick={() => { setCustomMode(false); setCustomVal(''); }} title="Cancel">✕</button>
        </div>
      ) : (
        <select
          className="sp-cell-select sp-label-add-select"
          value=""
          onChange={(e) => {
            const val = e.target.value;
            e.target.value = '';
            if (val === '__custom__') setCustomMode(true);
            else if (val) add(val);
          }}
        >
          <option value="">+ Add label…</option>
          {available.map((l) => <option key={l} value={l}>{l}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
      )}
    </div>
  );
});

/* ── Main view ──────────────────────────────────────────────────── */
const SprintPlanningView = () => {
  const dispatch = useDispatch();

  // Global sprint list (from header/board)
  const sprints = useSelector((s) => s.sprint.items);
  const selectedTeamId = useSelector((s) => s.auth.selectedTeamId);
  const user = useSelector((s) => s.auth.user);
  const teamId = selectedTeamId ?? user?.teamId;

  // Sprint planning slice
  const stories     = useSelector((s) => s.sprintPlanning.stories);
  const checkedIds  = useSelector((s) => s.sprintPlanning.checkedIds);
  const selectedSprintId = useSelector((s) => s.sprintPlanning.selectedSprintId);
  const projectKey  = useSelector((s) => s.sprintPlanning.projectKey);
  const epics       = useSelector((s) => s.sprintPlanning.epics);
  const step        = useSelector((s) => s.sprintPlanning.step);

  const checkedSet = new Set(checkedIds);

  // Local-only transient state
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadingStories, setLoadingStories] = useState(false);
  const [sprintError, setSprintError] = useState('');
  const [result, setResult] = useState(null);

  // Fetch board info + team epics once per session (skip if already loaded)
  useEffect(() => {
    if (!teamId || epics.length > 0) return;
    setLoadingBoard(true);
    const headers = getAuthHeaders();
    Promise.all([
      fetch(`/api/sprint-planning/board-info?teamId=${teamId}`, { headers }),
      fetch(`/api/sprint-planning/epics?teamId=${teamId}`, { headers }),
    ])
      .then(([r1, r2]) => Promise.all([r1.json(), r2.json()]))
      .then(([boardInfo, epicsData]) => {
        if (boardInfo.projectKey) dispatch(setPlanningProjectKey(boardInfo.projectKey));
        if (epicsData.epics?.length) dispatch(setPlanningEpics(epicsData.epics));
      })
      .catch(() => {})
      .finally(() => setLoadingBoard(false));
  }, [teamId, epics.length, dispatch]);

  // Pre-select the immediate upcoming sprint if none chosen yet
  useEffect(() => {
    if (selectedSprintId || sprints.length === 0) return;
    const upcoming = pickUpcomingSprint(sprints);
    if (upcoming) dispatch(setPlanningSprintId(String(upcoming.id)));
  }, [sprints, selectedSprintId, dispatch]);

  const allChecked  = checkedIds.length === stories.length && stories.length > 0;
  const someChecked = checkedIds.length > 0 && !allChecked;
  const totalSP     = stories.filter((s) => checkedSet.has(s.id)).reduce((acc, s) => acc + (Number(s.sp) || 0), 0);

  const handleUpdateField = useCallback(
    (id, field, value) => dispatch(updateStory({ id, field, value })),
    [dispatch]
  );

  /**
   * Step 1 → 2: lock in the sprint, then ask Jira what's already there.
   * Stories found → straight to the grid in edit mode; nothing found → count picker.
   */
  const handleSelectSprint = async (sprintId) => {
    dispatch(setPlanningSprintId(sprintId));
    setSprintError('');
    setResult(null);
    setLoadingStories(true);

    try {
      const res = await fetch(`/api/sprint-planning/sprint-stories?sprintId=${sprintId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load sprint stories');
      const data = await res.json();

      if (data.stories?.length > 0) dispatch(loadExistingStories(data.stories));
      else dispatch(setPlanningStep('count'));
    } catch (err) {
      setSprintError(`Couldn't load stories from Jira — ${err.message}`);
    } finally {
      setLoadingStories(false);
    }
  };

  const existingCount = stories.filter((s) => s.key).length;
  const editedRows    = stories.filter((s) => s.key && s.dirty && checkedSet.has(s.id));
  const newRows       = stories.filter((s) => !s.key && checkedSet.has(s.id) && s.summary.trim());

  const toPayload = (s) => ({
    summary: s.summary,
    description: s.description,
    storyPoints: Number(s.sp) || 0,
    labels: s.labels || [],
    epic: s.epic,
    dod: s.dod,
  });

  // Validate, then hand off to the confirmation modal — nothing is posted until it's confirmed
  const handlePost = () => {
    if (!selectedSprintId) { alert('Please select a sprint first.'); return; }
    if (!projectKey.trim()) { alert('Project key is required.'); return; }
    if (newRows.length === 0 && editedRows.length === 0) {
      alert(existingCount > 0
        ? 'Nothing to post — edit an existing story or add a new one first.'
        : 'Select at least one story with a summary.');
      return;
    }

    const missingDescription = [...newRows, ...editedRows].filter((s) => !s.description?.trim());
    if (missingDescription.length > 0) {
      const names = missingDescription.map((s) => s.key || s.summary || 'untitled').join(', ');
      alert(`Description is required. Please fill it in for: ${names}`);
      return;
    }

    setConfirming(true);
  };

  const doPost = async (sprintId) => {
    setConfirming(false);
    // The modal may have retargeted the sprint — keep the table's prefix in sync
    if (sprintId !== selectedSprintId) dispatch(setPlanningSprintId(sprintId));

    setPosting(true);
    setResult(null);

    const created = [];
    const updated = [];
    const errors = [];

    try {
      // Edits first, so a failure there doesn't leave new tickets stranded
      if (editedRows.length > 0) {
        const res = await fetch('/api/sprint-planning/update-stories', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({ stories: editedRows.map((s) => ({ key: s.key, ...toPayload(s) })) }),
        });
        const data = await res.json();
        updated.push(...(data.updated || []));
        errors.push(...(data.errors || []));
      }

      if (newRows.length > 0) {
        const res = await fetch('/api/sprint-planning/create-stories', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            sprintId: Number(sprintId),
            sprintName: sprints.find((s) => String(s.id) === sprintId)?.name || '',
            projectKey: projectKey.trim(),
            stories: newRows.map(toPayload),
          }),
        });
        const data = await res.json();
        created.push(...(data.created || []));
        errors.push(...(data.errors || []));
      }

      setResult({ success: created.length + updated.length > 0, created, updated, errors });

      // Re-read the sprint so keys, dirty flags and Jira-side changes line up again
      if (created.length + updated.length > 0) {
        const refresh = await fetch(`/api/sprint-planning/sprint-stories?sprintId=${sprintId}`, {
          headers: getAuthHeaders(),
        });
        if (refresh.ok) {
          const fresh = await refresh.json();
          if (fresh.stories?.length > 0) dispatch(loadExistingStories(fresh.stories));
        }
      }
    } catch (err) {
      setResult({ success: false, created, updated, errors: [...errors, { story: 'Request', error: err.message }] });
    } finally {
      setPosting(false);
    }
  };

  const sprintOptions = [...sprints].sort((a, b) => {
    const order = { active: 0, future: 1, closed: 2 };
    return (order[a.state] ?? 9) - (order[b.state] ?? 9);
  });

  const selectedSprintName = sprints.find((s) => String(s.id) === selectedSprintId)?.name || '';
  const upcomingSprint = pickUpcomingSprint(sprints);

  // Step 1 — always start by choosing the sprint to plan for
  if (step === 'sprint') {
    return (
      <>
        <SprintSelectModal
          sprints={sprintOptions}
          defaultSprintId={selectedSprintId || (upcomingSprint ? String(upcomingSprint.id) : '')}
          loading={loadingStories}
          error={sprintError}
          onStart={handleSelectSprint}
        />
        {loadingStories && (
          <BlockingLoader message="Loading sprint…" sub="Checking Jira for stories you already have" />
        )}
      </>
    );
  }

  // Step 2 — nothing in Jira yet, so ask how many stories to draft
  if (step === 'count') {
    return (
      <CountPickerModal
        sprintName={selectedSprintName}
        onBack={() => dispatch(changeTargetSprint())}
        onConfirm={(counts) => dispatch(initStories(counts))}
      />
    );
  }

  return (
    <div className="sp-view">
      {/* ── Header bar ──────────────────────────────────────── */}
      <div className="sp-topbar">
        <div className="sp-topbar-left">
          <h2 className="sp-title">Sprint Planning</h2>
          <span className="sp-subtitle">
            {existingCount > 0
              ? `Editing ${existingCount} ${existingCount === 1 ? 'story' : 'stories'} already in this sprint — changes are pushed back to Jira`
              : 'Plan stories for your sprint, then post them to Jira in one click'}
          </span>
        </div>

        <div className="sp-topbar-controls">
          <div className="sp-control-group">
            <label className="sp-label">Target Sprint</label>
            {/* Read-only here: switching sprints reloads the grid, so it goes back to step 1 */}
            <div className="sp-target-pill">
              <span className="sp-target-name" title={selectedSprintName}>{selectedSprintName || '— none —'}</span>
              <button
                className="sp-target-change"
                onClick={() => { setResult(null); dispatch(changeTargetSprint()); }}
                title="Pick a different sprint (reloads stories from Jira)"
              >
                Change
              </button>
            </div>
          </div>

          <div className="sp-control-group">
            <label className="sp-label">
              Project Key
              {loadingBoard && <span className="sp-fetching"> fetching…</span>}
            </label>
            <input
              className="sp-input sp-project-key"
              type="text"
              value={projectKey}
              onChange={(e) => dispatch(setPlanningProjectKey(e.target.value.toUpperCase()))}
              placeholder="e.g. TVPLAT"
              spellCheck={false}
            />
          </div>

          <div className="sp-control-group" style={{ justifyContent: 'flex-end' }}>
            <label className="sp-label">&nbsp;</label>
            <button
              className="sp-btn-reset"
              onClick={() => {
                setResult(null);
                // With existing tickets on screen, "reset" means re-read Jira, not wipe the grid
                if (existingCount > 0) handleSelectSprint(selectedSprintId);
                else dispatch(resetPlanning());
              }}
              title={existingCount > 0 ? 'Discard local edits and reload from Jira' : 'Clear all stories and start over'}
            >
              {existingCount > 0 ? 'Reload' : 'Reset'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="sp-table-wrapper">
        <table className="sp-table">
          <thead>
            <tr>
              <th className="sp-th sp-th-check">
                <input
                  type="checkbox"
                  className="sp-checkbox"
                  checked={allChecked}
                  ref={(el) => el && (el.indeterminate = someChecked)}
                  onChange={() => dispatch(toggleAllChecked())}
                  title="Select all"
                />
              </th>
              <th className="sp-th sp-th-num">#</th>
              <th className="sp-th sp-th-summary">Summary</th>
              <th className="sp-th sp-th-desc">Description <span className="sp-required" title="Required">*</span></th>
              <th className="sp-th sp-th-sp">SP</th>
              <th className="sp-th sp-th-label">Labels</th>
              <th className="sp-th sp-th-epic">Epic</th>
              <th className="sp-th sp-th-dod">Definition of Done</th>
              <th className="sp-th sp-th-del"></th>
            </tr>
          </thead>
          <tbody>
            {stories.map((story, idx) => (
              <tr key={story.id} className={`sp-row${checkedSet.has(story.id) ? ' sp-row--checked' : ''}`}>
                <td className="sp-td sp-td-check">
                  <input type="checkbox" className="sp-checkbox" checked={checkedSet.has(story.id)} onChange={() => dispatch(toggleChecked(story.id))} />
                </td>
                <td className="sp-td sp-td-num">{idx + 1}</td>

                <td className="sp-td sp-td-summary">
                  <div className="sp-summary-cell">
                    {story.key ? (
                      <a
                        className="sp-issue-key"
                        href={`${JIRA_BROWSE_URL}/${story.key}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${story.key} in Jira`}
                      >
                        {story.key}
                      </a>
                    ) : selectedSprintName && (
                      <span className="sp-summary-prefix">{selectedSprintName}</span>
                    )}
                    {story.dirty && <span className="sp-dirty-dot" title="Unsaved changes" />}
                    <input
                      className="sp-cell-input"
                      type="text"
                      value={story.summary}
                      onChange={(e) => handleUpdateField(story.id, 'summary', e.target.value)}
                      placeholder="Story summary…"
                    />
                  </div>
                </td>

                <td className="sp-td sp-td-desc">
                  <textarea
                    className="sp-cell-textarea"
                    value={story.description}
                    onChange={(e) => handleUpdateField(story.id, 'description', e.target.value)}
                    placeholder="Description… (required)"
                    rows={2}
                    required
                  />
                </td>

                <td className="sp-td sp-td-sp">
                  <input
                    className="sp-cell-input sp-cell-num"
                    type="number"
                    min={0}
                    max={99}
                    value={story.sp}
                    onChange={(e) => handleUpdateField(story.id, 'sp', e.target.value)}
                  />
                </td>

                <td className="sp-td sp-td-label">
                  <LabelCell
                    labels={story.labels}
                    onChange={(val) => handleUpdateField(story.id, 'labels', val)}
                  />
                </td>

                <td className="sp-td sp-td-epic">
                  {epics.length > 0 ? (
                    <select
                      className="sp-cell-select"
                      value={story.epic}
                      onChange={(e) => handleUpdateField(story.id, 'epic', e.target.value)}
                    >
                      <option value="">— None —</option>
                      {epics.map((e) => (
                        <option key={e.key} value={e.key}>{e.key}: {e.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="sp-cell-input"
                      type="text"
                      value={story.epic}
                      onChange={(e) => handleUpdateField(story.id, 'epic', e.target.value)}
                      placeholder="PROJ-123"
                    />
                  )}
                </td>

                <td className="sp-td sp-td-dod">
                  <textarea
                    className="sp-cell-textarea"
                    value={story.dod}
                    onChange={(e) => handleUpdateField(story.id, 'dod', e.target.value)}
                    placeholder="Acceptance criteria…"
                    rows={2}
                  />
                </td>

                <td className="sp-td sp-td-del">
                  {/* Existing tickets stay put — this grid never deletes anything in Jira */}
                  <button
                    className="sp-btn-del"
                    onClick={() => dispatch(removeStory(story.id))}
                    disabled={!!story.key}
                    title={story.key ? 'Existing Jira ticket — remove it in Jira' : 'Remove row'}
                    aria-label="Remove story"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer bar ──────────────────────────────────────── */}
      <div className="sp-footer">
        <button className="sp-btn-add" onClick={() => dispatch(addStory())}>+ Add Story</button>
        <div className="sp-footer-right">
          <span className="sp-sp-badge">
            {checkedIds.length} selected · <strong>{totalSP} SP</strong>
            {(newRows.length > 0 || editedRows.length > 0) && (
              <span className="sp-pending">
                {newRows.length > 0 && ` · ${newRows.length} new`}
                {editedRows.length > 0 && ` · ${editedRows.length} edited`}
              </span>
            )}
          </span>
          <button
            className="sp-btn-post"
            onClick={handlePost}
            disabled={posting || !selectedSprintId || (newRows.length === 0 && editedRows.length === 0)}
          >
            {posting ? 'Posting…' : editedRows.length > 0 && newRows.length === 0 ? 'Save changes' : 'Post to Jira'}
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmPostModal
          sprints={sprintOptions}
          defaultSprintId={selectedSprintId}
          newCount={newRows.length}
          editCount={editedRows.length}
          totalSP={totalSP}
          projectKey={projectKey.trim()}
          onConfirm={doPost}
          onCancel={() => setConfirming(false)}
        />
      )}

      {posting && (
        <BlockingLoader
          message={newRows.length > 0 ? 'Posting to Jira…' : 'Saving changes…'}
          sub="Please don't navigate away — this can take a few seconds per story."
        />
      )}

      {loadingStories && <BlockingLoader message="Reloading from Jira…" />}

      {sprintError && (
        <div className="sp-result sp-result--err">
          <div className="sp-result-errors"><strong>{sprintError}</strong></div>
        </div>
      )}

      {/* ── Result panel ────────────────────────────────────── */}
      {result && (
        <div className={`sp-result${result.success ? ' sp-result--ok' : ' sp-result--err'}`}>
          {result.created?.length > 0 && (
            <div className="sp-result-ok">
              <span className="sp-result-icon">✓</span>
              <div>
                <strong>{result.created.length} {result.created.length === 1 ? 'story' : 'stories'} created</strong>
                <div className="sp-result-keys">{result.created.join(', ')}</div>
              </div>
            </div>
          )}
          {result.updated?.length > 0 && (
            <div className="sp-result-ok">
              <span className="sp-result-icon">✓</span>
              <div>
                <strong>{result.updated.length} {result.updated.length === 1 ? 'ticket' : 'tickets'} updated</strong>
                <div className="sp-result-keys">{result.updated.join(', ')}</div>
              </div>
            </div>
          )}
          {result.errors?.length > 0 && (
            <div className="sp-result-errors">
              <strong>Errors:</strong>
              <ul className="sp-error-list">
                {result.errors.map((e, i) => (
                  <li key={i}><span className="sp-err-story">{e.story}:</span> {e.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SprintPlanningView;
