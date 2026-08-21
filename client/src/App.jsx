import { useEffect, useState, lazy, Suspense } from 'react'
import './App.css'

// Redux
import { useSelector, useDispatch } from "react-redux";
import { setAuth, fetchCurrentUser, setGerritConnected, setSelectedTeamId } from './store/slice/authSlice';
import { fetchSprints, setSelectedSprint } from './store/slice/sprintSlice';

// Routing
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, Outlet } from 'react-router-dom';

// Child Components
import Login from './views/login.jsx';
import BoardSelection from './views/BoardSelection.jsx';
import Header from './components/header';
import GerritLoginModal from './components/GerritLoginModal.jsx';

// Lazy load heavy components
const Dashboard = lazy(() => import('./views/dashboard.jsx'));
const WorklogPage = lazy(() => import('./views/WorklogPage'));

function AppLayout({ darkMode, onToggleDarkMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const sprints = useSelector((state) => state.sprint.items);
  const selectedSprint = useSelector((state) => state.sprint.selectedSprintId);
  const sprintStatus = useSelector((state) => state.sprint.status);
  const sprintError = useSelector((state) => state.sprint.error);
  const user = useSelector((state) => state.auth.user);
  const teams = useSelector((state) => state.auth.teams);
  const selectedTeamId = useSelector((state) => state.auth.selectedTeamId);
  const [showGerritModal, setShowGerritModal] = useState(false);

  const viewMode = location.pathname.includes('/dashboard/health') ? 'health' :
                   location.pathname.includes('/dashboard/visual') ? 'visual' :
                   location.pathname.includes('/dashboard/workItem') ? 'workItem' :
                   location.pathname.includes('/dashboard/issueItem') ? 'issueItem' :
                   location.pathname.includes('/dashboard/sprintReview') ? 'sprintReview' :
                   location.pathname.includes('/dashboard/patches') ? 'patches' :
                   location.pathname.includes('/dashboard/tvpms') ? 'tvpms' :
                   location.pathname.includes('/dashboard/worklog/') ? 'worklog' :
                   location.pathname.includes('/dashboard/sprintPlanning') ? 'sprintPlanning' : 'table';

  useEffect(() => {
    if (sprintStatus === 'idle' && user) {
      dispatch(fetchSprints());
    }
  }, [sprintStatus, dispatch, user]);

  return (
    <>
      <Header
        onNavigateKPI={() => navigate('/kpi')}
        onNavigateSprintReview={() => navigate('/sprint-review')}
        viewMode={viewMode}
        onToggleViewMode={(mode) => navigate(`/dashboard/${mode}`)}
        selectedSprintName={sprints.find(s => s.id === selectedSprint)?.name}
        onGerritOpen={() => setShowGerritModal(true)}
        sprints={sprints}
        selectedSprintId={selectedSprint}
        onSprintChange={(val) => dispatch(setSelectedSprint(val))}
        teams={teams}
        selectedTeamId={selectedTeamId}
        onTeamChange={(val) => dispatch(setSelectedTeamId(val))}
        isMemberView={location.pathname.startsWith('/worklog')}
        isKPIView={location.pathname.startsWith('/kpi')}
        isSprintReviewView={location.pathname.startsWith('/sprint-review')}
        sprintStatus={sprintStatus}
        sprintError={sprintError}
        gerritConnected={user?.gerritConnected || false}
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
      />

      <GerritLoginModal visible={showGerritModal} onClose={() => setShowGerritModal(false)} onSuccess={() => { setShowGerritModal(false); dispatch(setGerritConnected(true)); }} />
      <Outlet />
    </>
  );
}

function App() {
  const loggedIn = useSelector((state) => state.auth.isAuthenticated);
  const user = useSelector((state) => state.auth.user);
  const dispatch = useDispatch();

  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    try {
      localStorage.setItem('theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(prev => !prev);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('auth_token');
      if (token && token.trim().length > 0) {
        dispatch(setAuth(token));
        dispatch(fetchCurrentUser());
      }
    } catch (e) {
      console.debug('sessionStorage read error in App useEffect:', e);
    }
  }, [dispatch]);

  if (!loggedIn) {
    return <Login />;
  }

  if (user?.teamId == null) {
    return <BoardSelection />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="app-loading">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard/" replace />} />
          <Route element={<AppLayout darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />}>
            <Route path="dashboard/*" element={<Dashboard />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App
