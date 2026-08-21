/**
 * Worklog checklist templates, keyed by the issue's primary label
 * (the same `labels[0]` used to render the label badge on the ticket list).
 *
 * Each template declares:
 *   fields — one input per checklist point, rendered by WorklogPostForm
 *   build  — turns the field values into the comment lines, skipping blanks
 *
 * A `checkbox` field renders a bare line when ticked; a blank `text` field
 * drops its line entirely, so partially-filled templates stay clean.
 */

const cccLine = (status, build) =>
  ` - CCC ${status}${build ? ` -  ${build}` : ''}`;

export const WORKLOG_TEMPLATES = {
  issue: {
    fields: [
      { id: 'issueReviewed', label: 'Issue reviewed', type: 'select', options: ['completed', 'in progress', 'NA'], default: 'completed' },
      { id: 'issueType', label: 'Issue type', type: 'text', options: ['GUI', 'translation_issue', 'ui_issue', 'logic_issue'], placeholder: 'GUI', default: '' },
      { id: 'rootCause', label: 'Root cause identification', type: 'select', options: ['completed', 'in progress', 'NA'], default: 'completed' },
      { id: 'codePatch', label: 'Code patch created and reviewed', type: 'checkbox', default: true },
      { id: 'unitTest', label: 'Unit test case coverage report', type: 'select', options: ['yes', 'no', 'NA'], default: 'NA' },
      { id: 'cleanBuild', label: 'Clean build / Side load verification', type: 'checkbox', default: true },
      { id: 'cccStatus', label: 'CCC', type: 'select', options: ['completed', 'in progress', 'NA'], default: 'completed' },
      { id: 'cccBuild', label: 'Build number', type: 'text', placeholder: 'qilian_27', default: '' },
      { id: 'ticketLink', label: 'Ticket link', type: 'text', placeholder: 'http://jira.lge.com/issue/browse/...', default: '', fromIssueLink: true },
      { id: 'patchLink', label: 'Patch link', type: 'text', placeholder: 'https://wall.lge.com/c/app/...', default: '' },
    ],
    build: (v) => {
      const lines = [];
      if (v.issueReviewed) lines.push(` - Issue reviewed: ${v.issueReviewed}`);
      if (v.issueType) lines.push(` - Issue type: ${v.issueType}`);
      if (v.rootCause) lines.push(` - Issue root cause identification: ${v.rootCause}.`);
      if (v.codePatch) lines.push(' - code patch created and reviewed');
      if (v.unitTest) lines.push(` - Unit test case coverage report - ${v.unitTest}`);
      if (v.cleanBuild) lines.push(' - Clean build/Side load verification');
      if (v.cccStatus) lines.push(cccLine(v.cccStatus, v.cccBuild));
      if (v.ticketLink) lines.push(v.ticketLink);
      if (v.patchLink) lines.push(v.patchLink);
      return lines;
    },
  },

  development: {
    fields: [
      { id: 'requirementReviewed', label: 'Requirement reviewed', type: 'select', options: ['completed', 'in progress', 'NA'], default: 'completed' },
      { id: 'codePatch', label: 'Code patch created and reviewed', type: 'checkbox', default: true },
      { id: 'unitTest', label: 'Unit test case added report', type: 'select', options: ['yes', 'no', 'NA'], default: 'NA' },
      { id: 'cleanBuild', label: 'Clean build verification', type: 'checkbox', default: true },
      { id: 'cccStatus', label: 'CCC', type: 'select', options: ['completed', 'in progress', 'NA'], default: 'completed' },
      { id: 'cccBuild', label: 'Build number', type: 'text', placeholder: 'qilian_27', default: '' },
      { id: 'patchLink', label: 'Patch link', type: 'text', placeholder: 'https://wall.lge.com/c/app/...', default: '' },
      { id: 'epkLink', label: 'EPK link', type: 'text', placeholder: 'https://...', default: '' },
      { id: 'cccLink', label: 'CCC link', type: 'text', placeholder: 'https://...', default: '' },
    ],
    build: (v) => {
      const lines = [];
      if (v.requirementReviewed) lines.push(` - Requirement reviewed: ${v.requirementReviewed}.`);
      if (v.codePatch) lines.push(' - code patch created and reviewed');
      if (v.unitTest) lines.push(` - Unit test case added report - ${v.unitTest}`);
      if (v.cleanBuild) lines.push(' - Clean build verification');
      if (v.cccStatus) lines.push(cccLine(v.cccStatus, v.cccBuild));
      [v.patchLink, v.epkLink, v.cccLink].filter(Boolean).forEach((l) => lines.push(l));
      return lines;
    },
  },
};

export const getTemplate = (issue) => {
  const labels = (issue && issue.labels) || [];
  if (labels.length === 0) return null;
  return WORKLOG_TEMPLATES[String(labels[0]).toLowerCase()] || null;
};

/** Seeds each field with its default; link fields marked `fromIssueLink` pick up the ticket URL. */
export const getInitialValues = (template, issue) => {
  if (!template) return {};
  return template.fields.reduce((acc, f) => {
    acc[f.id] = f.fromIssueLink && issue && issue.link ? issue.link : f.default;
    return acc;
  }, {});
};

/** Assembles the full worklog comment: labels line, checklist lines, then free-form notes. */
export const buildComment = ({ issue, template, values, notes }) => {
  const labels = (issue && issue.labels) || [];
  const lines = [];

  if (labels.length > 0) lines.push(labels.join(', '));
  if (template) lines.push(...template.build(values));
  if (notes && notes.trim()) lines.push(notes.trim());

  return lines.join('\n');
};
