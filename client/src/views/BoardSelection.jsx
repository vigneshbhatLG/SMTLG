import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setSelectedBoard } from '../store/slice/authSlice';
import './css/BoardSelection.css';
import bg from '../assets/BG/bg1.jpg';
import lgSticker from '../assets/LG/logo_animation.gif';

function BoardSelection() {
  const dispatch = useDispatch();
  const token = useSelector((state) => state.auth.token);
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBoards();
  }, [token]);

  const fetchBoards = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/boards/list', {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch boards');
      }

      const data = await response.json();
      setBoards(data.boards || []);

      if (data.boards.length === 0) {
        setError('No boards available');
      }
    } catch (err) {
      console.error('Error fetching boards:', err);
      setError(err.message || 'Failed to load boards');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBoard = (boardId) => {
    setSelectedBoardId(boardId);
  };

  const handleContinue = () => {
    if (!selectedBoardId) {
      setError('Please select a board to continue');
      return;
    }

    dispatch(setSelectedBoard(selectedBoardId));

  };

  return (
    <div
      className="board-selection-container"
      style={{
        backgroundImage: `url(${bg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        height: '100vh',
        width: '100vw'
      }}
    >
      <img src={lgSticker} alt="LG OLED Sticker" className="lg-sticker" />

      {loading && (
        <div className="loading-spinner">
          <p>Loading boards...</p>
        </div>
      )}

      {error && !loading && (
        <p className="board-selection-error">{error}</p>
      )}

      {!loading && boards.length > 0 && (
        <div className="board-selection-form">
          <h2>Select a Board</h2>
          <div className="board-select-wrapper">
            <select
              className="board-select"
              value={selectedBoardId || ''}
              onChange={(e) => handleSelectBoard(Number(e.target.value))}
            >
              <option value="">-- Select a Board --</option>
              {boards.map((board) => (
                <option key={board.boardId} value={board.boardId}>
                  {board.teamName} (Board {board.boardId})
                </option>
              ))}
            </select>
            <span className="board-select-caret" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </div>

          <button
            onClick={handleContinue}
            className="board-continue-button"
            disabled={!selectedBoardId}
          >
            Continue to Dashboard
          </button>
        </div>
      )}

      {!loading && boards.length === 0 && !error && (
        <div className="no-boards">
          <p>No boards available. Please contact your administrator.</p>
        </div>
      )}
    </div>
  );
}

export default BoardSelection;
