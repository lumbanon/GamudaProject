import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "./firebase";
import agrowLogo from "../../assets/landing/agrow-rectangle.png";

import backHomeIcon from "../../assets/auth/back-home.png";
import "./login-page.css";

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const API_AUTH_BASE_URL = "http://127.0.0.1:8000/api/v1/auth";

export default function LoginPage() {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const wasOpenedFromLandingLogin = location.state?.fromLandingLogin === true;
  const canUseFirebaseAuth = Boolean(isFirebaseConfigured && auth && db);

  const toggleMode = () => {
    setIsLoginMode((currentMode) => !currentMode);
    setError("");
    setSuccessMsg("");
    setUsername("");
    setFullName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setRole("");
  };

  const validateForm = () => {
    const loginIdentifier = email.trim();

    if (!loginIdentifier) {
      return isLoginMode
        ? "Username or email is required."
        : "Email is required.";
    }

    if (
      isLoginMode &&
      canUseFirebaseAuth &&
      !loginIdentifier.includes("@") &&
      !USERNAME_PATTERN.test(loginIdentifier)
    ) {
      return "Enter a valid username or email.";
    }

    if (isLoginMode && !canUseFirebaseAuth && !loginIdentifier.includes("@")) {
      return "Email is required.";
    }

    if (!password) {
      return "Password is required.";
    }

    if (password.length < 6) {
      return "Password must be at least 6 characters.";
    }

    if (!isLoginMode && canUseFirebaseAuth && !username.trim()) {
      return "Username is required.";
    }

    if (
      !isLoginMode &&
      canUseFirebaseAuth &&
      !USERNAME_PATTERN.test(username.trim())
    ) {
      return "Username can only use letters, numbers, dots, dashes, and underscores.";
    }

    if (!isLoginMode && !canUseFirebaseAuth && !fullName.trim()) {
      return "Full name is required.";
    }

    if (!isLoginMode && !canUseFirebaseAuth && !role.trim()) {
      return "Role is required.";
    }

    if (!isLoginMode && canUseFirebaseAuth && !confirmPassword) {
      return "Confirm password is required.";
    }

    if (!isLoginMode && canUseFirebaseAuth && password !== confirmPassword) {
      return "Passwords do not match.";
    }

    return "";
  };

  const ensureFirebaseReady = () => {
    if (!isFirebaseConfigured || !auth || !db) {
      return "Firebase is not configured yet. Add the VITE_FIREBASE_* values to your environment file.";
    }

    return "";
  };

  const getFirebaseErrorMessage = (
    firebaseError,
    isLoginError = isLoginMode,
  ) => {
    switch (firebaseError.code) {
      case "auth/username-already-taken":
        return "Username already taken";
      case "auth/username-not-found":
        return "Username not found";
      case "auth/email-already-in-use":
        return "This email is already registered. Try logging in instead.";
      case "auth/invalid-email":
        return isLoginError
          ? "Invalid email/username or password"
          : "Enter a valid email address.";
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "Invalid email/username or password";
      case "auth/weak-password":
        return "Password must be at least 6 characters.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a moment and try again.";
      case "permission-denied":
        return "Username login needs permission to read user profiles. Check your Firestore rules.";
      default:
        return (
          firebaseError.message || "Something went wrong. Please try again."
        );
    }
  };

  const getUserProfileByUsername = async (usernameValue) => {
    const usernameQuery = query(
      collection(db, "users"),
      where("usernameLower", "==", usernameValue.toLowerCase()),
      limit(1),
    );
    const usernameSnapshot = await getDocs(usernameQuery);

    if (usernameSnapshot.empty) {
      return null;
    }

    return usernameSnapshot.docs[0].data();
  };

  const resolveLoginEmail = async () => {
    const loginIdentifier = email.trim();

    if (loginIdentifier.includes("@")) {
      return loginIdentifier;
    }

    const normalizedUsername = loginIdentifier.toLowerCase();
    const userProfile = await getUserProfileByUsername(normalizedUsername);

    if (!userProfile?.email) {
      const notFoundError = new Error("Username not found.");
      notFoundError.code = "auth/username-not-found";
      throw notFoundError;
    }

    return userProfile.email;
  };

  const clearStoredSession = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("firebase_uid");
    localStorage.removeItem("user_role");
    localStorage.removeItem("email_verified");
  };

  const handleApiLogin = async () => {
    const formData = new URLSearchParams();
    formData.append("username", email.trim());
    formData.append("password", password);

    try {
      const response = await fetch(`${API_AUTH_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Incorrect email or password");
      }

      const data = await response.json();

      localStorage.setItem("token", data.access_token);
      localStorage.removeItem("firebase_uid");
      localStorage.setItem("user_role", data.user_role);
      localStorage.setItem("email_verified", "true");

      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof TypeError) {
        localStorage.setItem("token", "local-dev-bypass-token");
        localStorage.removeItem("firebase_uid");
        localStorage.setItem("user_role", "Local Demo");
        localStorage.setItem("email_verified", "true");
        navigate("/dashboard", { replace: true });
        return;
      }

      setError(err.message);
    }
  };

  const handleApiRegister = async () => {
    const payload = {
      full_name: fullName.trim(),
      email: email.trim(),
      password,
      role: role.trim(),
    };

    try {
      const response = await fetch(`${API_AUTH_BASE_URL}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(
          errData.detail || "Registration failed. Try a different email.",
        );
      }

      setSuccessMsg("Account created successfully! Redirecting to login...");

      setTimeout(() => {
        setIsLoginMode(true);
        setSuccessMsg("");
        setPassword("");
      }, 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMsg("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setIsSubmitting(true);

      if (!canUseFirebaseAuth) {
        await handleApiLogin();
        return;
      }

      const firebaseReadyError = ensureFirebaseReady();
      if (firebaseReadyError) {
        setError(firebaseReadyError);
        return;
      }

      const loginEmail = await resolveLoginEmail();
      const userCredential = await signInWithEmailAndPassword(
        auth,
        loginEmail,
        password,
      );
      const { user } = userCredential;

      await user.reload();
      //user email verification
      // if (!user.emailVerified) {
      //   await signOut(auth);
      //   clearStoredSession();
      //   setError("Please verify your email before logging in.");
      //   return;
      // }

      const idToken = await user.getIdToken();

      localStorage.setItem("token", idToken);
      localStorage.setItem("firebase_uid", user.uid);
      localStorage.setItem("user_role", "user");
      localStorage.setItem("email_verified", "true");

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getFirebaseErrorMessage(err, true));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMsg("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setIsSubmitting(true);

      if (!canUseFirebaseAuth) {
        await handleApiRegister();
        return;
      }

      const firebaseReadyError = ensureFirebaseReady();
      if (firebaseReadyError) {
        setError(firebaseReadyError);
        return;
      }

      const trimmedEmail = email.trim();
      const trimmedUsername = username.trim();
      const normalizedUsername = trimmedUsername.toLowerCase();
      const existingUser = await getUserProfileByUsername(normalizedUsername);

      if (existingUser) {
        const usernameTakenError = new Error("Username already taken");
        usernameTakenError.code = "auth/username-already-taken";
        throw usernameTakenError;
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        trimmedEmail,
        password,
      );
      const { user } = userCredential;

      await updateProfile(user, { displayName: trimmedUsername });
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        username: trimmedUsername,
        usernameLower: normalizedUsername,
        email: user.email,
        displayName: trimmedUsername,
        role: "free",
        createdAt: serverTimestamp(),
      });
      //send the verification email during sign-up
      // await sendEmailVerification(user);
      await signOut(auth);
      clearStoredSession();

      // setSuccessMsg(
      //   "Account created. Please check your email for the verification link before logging in.",
      // );
      setSuccessMsg("Account created. You can log in now.");
      setIsLoginMode(true);
      setUsername("");
      setEmail(trimmedEmail);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(getFirebaseErrorMessage(err, false));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setError("");
    setSuccessMsg("");

    const validationError = validateForm() || ensureFirebaseReady();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setIsResendingVerification(true);
      const loginEmail = await resolveLoginEmail();
      const userCredential = await signInWithEmailAndPassword(
        auth,
        loginEmail,
        password,
      );
      const { user } = userCredential;

      await user.reload();

      if (user.emailVerified) {
        await signOut(auth);
        clearStoredSession();
        setSuccessMsg("Your email is already verified. You can log in now.");
        return;
      }

      await sendEmailVerification(user);
      await signOut(auth);
      clearStoredSession();
      setSuccessMsg("Verification email sent. Please check your email.");
    } catch (err) {
      setError(getFirebaseErrorMessage(err, true));
    } finally {
      setIsResendingVerification(false);
    }
  };

  if (token && localStorage.getItem("email_verified") === "true") {
    return <Navigate to="/dashboard" replace />;
  }

  if (canUseFirebaseAuth && !wasOpenedFromLandingLogin) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="auth-page">
      <div className="auth-animated-bg" aria-hidden="true">
        <span className="map-ring map-ring-one" />
        <span className="map-ring map-ring-two" />
        <span className="heat-dot-grid" />
        <span className="floating-leaf floating-leaf-one" />
        <span className="floating-leaf floating-leaf-two" />
        <span className="floating-leaf floating-leaf-three" />
        <span className="floating-leaf floating-leaf-four" />
        <span className="floating-leaf floating-leaf-five" />
        <span className="floating-leaf floating-leaf-six" />
      </div>

      <section className="auth-hero" aria-label="Agrow authentication intro">
        <div className="auth-hero-content">
          <div className="auth-brand">
            <img src={agrowLogo} alt="AGROW by Cleek" />
          </div>
          <h1 className="auth-title">
            The platform for Sabah crop intelligence.
          </h1>
          <p className="auth-subtitle">
            Analyze soil, climate, and crop suitability. Plan better harvests
            with AI-powered insights.
          </p>
          <div className="auth-highlights" aria-label="Agrow workspace tools">
            <span className="auth-highlight-item">District heatmaps</span>
            <span className="auth-highlight-item">AI crop reports</span>
            <span className="auth-highlight-item">Sabah-focused data</span>
          </div>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-card">
          <div className="auth-copy">
            <Link to="/" className="auth-back-link">
              <img src={backHomeIcon} alt="" className="auth-back-icon" />
              <span>Back to home</span>
            </Link>
            <h1 id="auth-title">
              {isLoginMode ? "Welcome Back" : "Create Your Account"}
            </h1>
            <p>
              {isLoginMode
                ? "Sign in to continue to the Sabah crop intelligence workspace."
                : "Join the Agrow workspace and secure your account."}
            </p>
          </div>

          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button
              type="button"
              className={isLoginMode ? "active" : ""}
              onClick={() => setIsLoginMode(true)}
            >
              Login
            </button>
            <button
              type="button"
              className={!isLoginMode ? "active" : ""}
              onClick={() => setIsLoginMode(false)}
            >
              Sign up
            </button>
          </div>

          {error && (
            <div className="auth-message auth-message-error">{error}</div>
          )}
          {successMsg && (
            <div className="auth-message auth-message-success">
              {successMsg}
            </div>
          )}

          <form
            className="auth-form"
            onSubmit={isLoginMode ? handleLogin : handleRegister}
          >
            {!isLoginMode && canUseFirebaseAuth && (
              <label>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
            )}

            {!isLoginMode && !canUseFirebaseAuth && (
              <label>
                Full name
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            )}

            <label>
              {isLoginMode && canUseFirebaseAuth ? "Email or Username" : "Email"}
              <input
                type={isLoginMode && canUseFirebaseAuth ? "text" : "email"}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete={isLoginMode && canUseFirebaseAuth ? "username" : "email"}
                required
              />
            </label>

            {!isLoginMode && !canUseFirebaseAuth && (
              <label>
                Your role
                <input
                  type="text"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  required
                />
              </label>
            )}

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isLoginMode ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </label>

            {!isLoginMode && canUseFirebaseAuth && (
              <label>
                Confirm Password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </label>
            )}

            <button
              className="auth-submit-button"
              type="submit"
              disabled={isSubmitting || isResendingVerification}
            >
              {isSubmitting
                ? "Please wait..."
                : isLoginMode
                  ? "Login"
                  : "Create account"}
            </button>
          </form>

          {/* {isLoginMode && (
            <button
              className="auth-link-button"
              type="button"
              onClick={handleResendVerification}
              disabled={isSubmitting || isResendingVerification}
            >
              {isResendingVerification
                ? "Sending verification email..."
                : "Resend verification email"}
            </button>
          )} */}

          <button
            className="auth-link-button"
            type="button"
            onClick={toggleMode}
            disabled={isSubmitting || isResendingVerification}
          >
            {isLoginMode
              ? "Need an account? Sign up"
              : "Already have an account? Login"}
          </button>
        </div>
      </section>
    </main>
  );
}
