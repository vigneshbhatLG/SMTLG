import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getAuthHeaders } from '../utils/api';
import { fetchWorklogComments } from '../store/slice/worklogSlice';

function WorklogComments({ worklog, issueKey }) {
  const dispatch = useDispatch();
  const [localReplies, setLocalReplies] = useState([]);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');

  const issueCommentsFromState = useSelector((state) => (state.worklog && state.worklog.commentsByIssue) || {});
  const userFromState = useSelector((state) => state.auth && state.auth.user) || null;
  const selectedSprint = useSelector((state) => state.sprint.selectedSprintId);
  const member = useSelector((state) => state.auth.user?.name); // assuming member is the user name

  const persisted = issueKey ? (issueCommentsFromState[issueKey] || []) : [];
  const commentsForWorklog = persisted.filter((c) => String(c.worklogId) === String(worklog.id));

  const allReplies = [...(worklog.replies || []), ...localReplies];

  async function submitReply() {
    if (!replyText || replyText.trim() === '') return;
    const username = (userFromState && userFromState.name) || 'unknown';
    const payload = {
      issueId: issueKey || null,
      username,
      datetime: new Date().toISOString(),
      comment: replyText.trim()
    };

    let res;
    try {
      const headers = getAuthHeaders();
      res = await fetch(`/api/worklogs/${encodeURIComponent(worklog.id)}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Network error saving worklog comment', err);
    }

    if (res && res.ok) {
      // refresh persisted comments so username/date are shown
      try {
        dispatch(fetchWorklogComments({ issueId: issueKey }));
      } catch (err) {
        console.log('Error fetching worklog comments after posting', err);
        setLocalReplies((prev) => [...prev, replyText.trim()]);
      }
    } else {
      setLocalReplies((prev) => [...prev, replyText.trim()]);
    }

    setReplyText('');
    setShowReply(false);
  }

  return (
    <div className="replies">
      {allReplies.map((r, idx) => (
        <div key={`local-${idx}`} className="reply-item">{r}</div>
      ))}

      {commentsForWorklog.map((c, i) => (
        <div key={c._id || `persist-${i}`} className="persisted-comment">
          <div className="persisted-user">{c.username} <span className="persisted-date">• {new Date(c.createdAt || c.datetime).toLocaleString()}</span></div>
          <div style={{ marginTop: 6 }}>{c.comment}</div>
        </div>
      ))}

      {showReply ? (
        <div style={{ marginTop: 8 }}>
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3} className="reply-textarea" />
          <div className="reply-actions">
            <button onClick={submitReply} className="action-btn">Submit</button>
            <button onClick={() => { setShowReply(false); setReplyText(''); }} className="action-btn">Cancel</button>
          </div>
        </div>
      ) : (
        userFromState && (userFromState.memberRole == 0 || userFromState.memberRole === '0') && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowReply(true)} className="small-btn">Reply</button>
          </div>
        )
      )}
    </div>
  );
}

export default WorklogComments;
