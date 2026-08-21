import React from 'react';
import './css/header.css';
import logo from '../assets/LG/LG_symbol.svg';

import { useDispatch } from "react-redux";
import { logout } from "../store/slice/authSlice";
import { Link } from 'react-router-dom';

const NAV_ITEMS = [
  { key: 'health',         label: 'Dashboard'      },
  { key: 'table',          label: 'Analytics'      },
  { key: 'workItem',       label: 'Work Items'     },
  { key: 'issueItem',      label: 'Issues'         },
  { key: 'sprintReview',   label: 'Sprint Review'  },
  { key: 'patches',        label: 'Patches'        },
  { key: 'tvpms',          label: 'TVPMs'          },
  { key: 'sprintPlanning', label: 'Sprint Planning'},
];

const Header = ({
  viewMode,
  onToggleViewMode,
  unitMode,
  onToggleUnitMode,
  onGerritOpen,
  sprints,
  selectedSprintId,
  onSprintChange,
  isMemberView,
  isKPIView,
  sprintStatus,
  sprintError,
  gerritConnected,
  teams,
  selectedTeamId,
  onTeamChange,
  darkMode,
  onToggleDarkMode,
}) => {
  const dispatch = useDispatch();

  return (
    <header className="app-header">
      {/* ── Brand ──────────────────────────────────────────────── */}
      <div className="header-brand">
        <Link to="/" className="header-brand-link">
          <img src={logo} alt="LG" className="header-logo" />
          <span className="header-brand-name">Sprint Analytics</span>
        </Link>
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      {!(isMemberView || isKPIView) && (
        <nav className="header-nav" role="navigation">
          <div className="nav-tabs">
            {NAV_ITEMS.map(({ key, label }) => (
              <button
                key={key}
                className={`nav-tab ${viewMode === key ? 'nav-tab--active' : ''}`}
                onClick={() => onToggleViewMode(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Sprint + Team selects */}
          <div className="header-selects">
            {sprintStatus === 'failed' && (
              <span className="sprint-error-badge">{sprintError}</span>
            )}
            {sprints && sprints.length > 0 && (
              <div className="select-wrapper">
                <select
                  className="header-select"
                  value={selectedSprintId || ''}
                  onChange={(e) => onSprintChange?.(e.target.value)}
                  aria-label="Select sprint"
                >
                  <option value="">Sprint</option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <span className="select-caret" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </div>
            )}
            {teams && teams.length > 0 && (
              <div className="select-wrapper">
                <select
                  className="header-select"
                  value={selectedTeamId ?? ''}
                  onChange={(e) => onTeamChange?.(e.target.value)}
                  aria-label="Select team"
                >
                  <option value="">Team</option>
                  {teams.map((t) => (
                    <option key={t._id || t.teamId} value={t.teamId}>{t.teamName}</option>
                  ))}
                </select>
                <span className="select-caret" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </div>
            )}
          </div>
        </nav>
      )}

      {/* ── Right controls ──────────────────────────────────────── */}
      <div className="header-controls">
        {/* Unit toggle — only in visual mode */}
        {onToggleUnitMode && viewMode === 'visual' && (
          <div className="select-wrapper">
            <select
              className="header-select"
              value={unitMode}
              onChange={(e) => onToggleUnitMode?.(e.target.value)}
              aria-label="Display unit"
            >
              <option value="sp">SP</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
            <span className="select-caret" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </div>
        )}

        {/* Theme toggle */}
        <label
          className="theme-toggle"
          title={darkMode ? 'Light mode' : 'Dark mode'}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <input
            type="checkbox"
            className="theme-toggle__input"
            checked={!!darkMode}
            onChange={onToggleDarkMode}
          />
          <span className="theme-toggle__track">
            <span className="theme-toggle__thumb" />
          </span>
        </label>

        {/* Gerrit */}
        {!gerritConnected && (
          <button className="btn-outline" onClick={() => onGerritOpen?.()}>
            Gerrit
          </button>
        )}

        {/* Logout */}
        <button className="btn-logout" onClick={() => dispatch(logout())}>
          Sign out
        </button>
      </div>
    </header>
  );
};

export default Header;
