import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDispatch } from 'react-redux';
import { postWorklog } from '../store/slice/worklogSlice';
import { getTemplate, getInitialValues, buildComment } from './worklogTemplates';
import './css/WorklogPostForm.css';

// Helper function to get local datetime in YYYY-MM-DDTHH:MM format
const getLocalDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function WorklogPostForm({ issueId, issue, onSuccess }) {
  const dispatch = useDispatch();
  const [timeSpent, setTimeSpent] = useState('');
  const [started, setStarted] = useState(getLocalDateTime());
  const [notes, setNotes] = useState('');
  const [notesHistory, setNotesHistory] = useState(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef(null);
  const timeInputRef = useRef(null);

  const template = useMemo(() => getTemplate(issue), [issue]);
  const [values, setValues] = useState(() => getInitialValues(template, issue));

  // The exact text posted to Jira — labels line, checklist, then notes.
  const preview = useMemo(
    () => buildComment({ issue, template, values, notes }),
    [issue, template, values, notes]
  );

  const resetFields = () => {
    setValues(getInitialValues(template, issue));
    setNotes('');
    setNotesHistory(['']);
    setHistoryIndex(0);
  };

  // Reseed the checklist whenever a different ticket is selected
  useEffect(() => {
    setValues(getInitialValues(template, issue));
    setNotes('');
    setNotesHistory(['']);
    setHistoryIndex(0);
    setTimeout(() => {
      if (timeInputRef.current) timeInputRef.current.focus();
    }, 0);
  }, [issue, template]);

  useEffect(() => {
    // Set default started time to current date/time in local timezone
    setStarted(getLocalDateTime());
  }, []);

  // Auto-expand textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [notes]);

  const setField = (id, value) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  const updateNotesHistory = (newNotes) => {
    // Remove any future history if we're not at the latest state
    const newHistory = notesHistory.slice(0, historyIndex + 1);
    newHistory.push(newNotes);
    setNotesHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setNotes(newNotes);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setNotes(notesHistory[newIndex]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < notesHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setNotes(notesHistory[newIndex]);
    }
  };

  const handleNotesChange = (e) => {
    updateNotesHistory(e.target.value);
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      handleRedo();
    }
  };

  const insertFormatting = (formatType) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = notes.substring(start, end);
    const beforeText = notes.substring(0, start);
    const afterText = notes.substring(end);

    let insertedText = '';
    let cursorOffset = 0;

    switch (formatType) {
      case 'bullet':
        insertedText = '• ';
        cursorOffset = insertedText.length;
        break;
      case 'number':
        insertedText = '1. ';
        cursorOffset = insertedText.length;
        break;
      case 'bold':
        insertedText = selectedText ? `*${selectedText}*` : '**';
        cursorOffset = selectedText ? insertedText.length : 1;
        break;
      case 'italic':
        insertedText = selectedText ? `_${selectedText}_` : '__';
        cursorOffset = selectedText ? insertedText.length : 1;
        break;
      default:
        return;
    }

    updateNotesHistory(beforeText + insertedText + afterText);

    // Set cursor position after formatting
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + cursorOffset;
      textarea.focus();
    }, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!timeSpent.trim()) {
      setError('Time spent is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await dispatch(
        postWorklog({ issueId, timeSpent, started, comment: preview })
      ).unwrap();
      onSuccess && onSuccess(result);
      setTimeSpent('');
      setStarted(getLocalDateTime());
      resetFields();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field) => {
    const value = values[field.id];

    if (field.type === 'checkbox') {
      return (
        <label key={field.id} className="checklist-field checklist-field--check">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => setField(field.id, e.target.checked)}
            disabled={loading}
          />
          <span>{field.label}</span>
        </label>
      );
    }

    if (field.type === 'select') {
      return (
        <label key={field.id} className="checklist-field">
          <span className="checklist-label">{field.label}</span>
          <select
            className="form-input checklist-input"
            value={value}
            onChange={(e) => setField(field.id, e.target.value)}
            disabled={loading}
          >
            <option value="">— skip —</option>
            {field.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
      );
    }

    const listId = field.options ? `${field.id}-options` : undefined;
    return (
      <label key={field.id} className="checklist-field">
        <span className="checklist-label">{field.label}</span>
        <input
          type="text"
          className="form-input checklist-input"
          value={value}
          list={listId}
          placeholder={field.placeholder}
          onChange={(e) => setField(field.id, e.target.value)}
          disabled={loading}
        />
        {field.options && (
          <datalist id={listId}>
            {field.options.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        )}
      </label>
    );
  };

  return (
    <div className="worklog-post-form">
      <h3>Log Work</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label htmlFor="timeSpent" className="form-label">
            Time Spent (e.g., 1h 30m, 2h):
          </label>
          <input
            id="timeSpent"
            ref={timeInputRef}
            type="text"
            value={timeSpent}
            onChange={(e) => setTimeSpent(e.target.value)}
            placeholder="1h 30m"
            className="form-input time-input"
            disabled={loading}
          />
        </div>
        <div className="form-row">
          <label htmlFor="started" className="form-label">
            Started At:
          </label>
          <input
            id="started"
            type="datetime-local"
            value={started}
            onChange={(e) => setStarted(e.target.value)}
            className="form-input datetime-input"
            disabled={loading}
            max={getLocalDateTime()}
          />
        </div>

        {template && (
          <div className="checklist-section">
            <div className="checklist-grid">
              {template.fields.map(renderField)}
            </div>
          </div>
        )}

        <div className="form-row comment-row">
          <label htmlFor="comment" className="form-label comment-label">
            Additional notes:
          </label>
          <div className="formatting-toolbar">
            <button
              type="button"
              className="format-btn"
              onClick={() => insertFormatting('bullet')}
              title="Add bullet point"
              disabled={loading}
            >
              • Bullet
            </button>
            <button
              type="button"
              className="format-btn"
              onClick={() => insertFormatting('number')}
              title="Add numbered list"
              disabled={loading}
            >
              1. List
            </button>
            <button
              type="button"
              className="format-btn"
              onClick={() => insertFormatting('bold')}
              title="Make bold"
              disabled={loading}
            >
              <strong>B</strong> Bold
            </button>
            <button
              type="button"
              className="format-btn"
              onClick={() => insertFormatting('italic')}
              title="Make italic"
              disabled={loading}
            >
              <em>I</em> Italic
            </button>
          </div>
          <textarea
            id="comment"
            ref={textareaRef}
            value={notes}
            onChange={handleNotesChange}
            onKeyDown={handleKeyDown}
            placeholder="Anything to add beyond the checklist?"
            rows={3}
            className="form-input comment-input"
            disabled={loading}
          />
        </div>

        <div className="worklog-preview">
          <div className="worklog-preview-header">Preview — this is what gets posted</div>
          <pre className="worklog-preview-body">{preview || 'Nothing to post yet.'}</pre>
        </div>

        {error && <div className="error-message">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="submit-button"
        >
          {loading ? 'Posting...' : 'Log Work'}
        </button>
      </form>
    </div>
  );
}

export default WorklogPostForm;
