import { store } from '../store';

export function getAuthHeaders(contentType = "application/json") {
  const headers = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  try {
    // Prefer token stored in Redux state
    const stateToken = store && store.getState && store.getState().auth && store.getState().auth.token;
    const token = stateToken || sessionStorage.getItem("auth_token");
    if (token) {
      headers["Authorization"] = token;
    }

		// Optional Gerrit token (encrypted). Server will use this for Gerrit API calls.
		const gerritToken = sessionStorage.getItem('gerrit_token');
		if (gerritToken && gerritToken.trim().length > 0) {
			headers['X-Gerrit-Token'] = gerritToken;
		}

    // Explicit flag requested: isgerritconnected
    headers['X-IsGerritConnected'] = gerritToken && gerritToken.trim().length > 0 ? 'true' : 'false';
  } catch (e) {
    console.debug("getAuthHeaders error:", e);
  }

  return headers;
}
