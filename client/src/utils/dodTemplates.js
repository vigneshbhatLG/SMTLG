/**
 * Default "Definition of Done" text, keyed by a story's primary label
 * (labels[0] — the same label the count picker seeds each row with).
 *
 * Rows are pre-filled with the template for their label. If the user later
 * changes the label, the DoD follows along — but only while the text is still
 * untouched (empty, or exactly one of the templates below), so hand-written
 * criteria are never overwritten.
 */

export const DOD_TEMPLATES = {
  issue: [
    ' - Issue reviewed.',
    ' - Issue root cause identification.',
    ' - code patch created and reviewed.',
    ' - Unit test case coverage report.',
    ' - Clean build/Side load verification.',
    ' - Waiting for clarification.',
    ' - Issue type.',
    ' - CCC link.',
  ].join('\n'),

  development: [
    ' - Requirement reviewed: completed.',
    ' - code patch created and reviewed.',
    ' - Unit test case added report.',
    ' - Clean build verification.',
    ' - CCC link.',
  ].join('\n'),

  planned_leave: ' - Planned Leave availed on <date>',

  operation: [
    ' - Attended Team daily meeting',
    ' - Participated in Sprint activities',
  ].join('\n'),

  training: [
    ' - Attended weekly Tests',
    ' - Practiced DSA Problems',
  ].join('\n'),
};

/** DoD for a story's primary label; empty string for labels with no template. */
export const getDodForLabels = (labels) => {
  const primary = Array.isArray(labels) && labels.length > 0 ? String(labels[0]).toLowerCase() : '';
  return DOD_TEMPLATES[primary] || '';
};

/** True when the field still holds a generated default the user hasn't edited. */
export const isDefaultDod = (dod) => {
  if (!dod || !dod.trim()) return true;
  return Object.values(DOD_TEMPLATES).includes(dod);
};
