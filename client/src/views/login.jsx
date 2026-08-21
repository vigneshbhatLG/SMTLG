import { useState } from 'react';
import './css/login.css';
import bg from '../assets/BG/bg1.jpg';
import lgSticker from '../assets/LG/logo_animation.gif';

// redux
import { useDispatch, useSelector } from "react-redux";
import { loginUser } from "../store/slice/authSlice";

function login() {
    const [token, setToken] = useState("");

    const dispatch = useDispatch();
    const authStatus = useSelector((state) => state.auth.status);
    const authError = useSelector((state) => state.auth.error);

    const handleLogin = () => {
      if (token.trim() !== "") {
        dispatch(loginUser(token));
      }
    };

  return (
    <> 
      <div className="login-container" style={{ backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center', height: '100vh', width: '100vw' }}>
        <img src={lgSticker} alt="LG OLED Sticker" className="lg-sticker" />
        <h1>Sprint Analytics</h1>
        <div className="login-form">
          <input
          type="password" 
          placeholder="Enter PAT"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="login-input"
        />
          <button onClick={handleLogin} className="login-button">Login with Jira</button>
        </div>
        {authError && <p className="login-error">Login failed: {authError}</p>}
        
      </div>
    </>
  )
}

export default login;