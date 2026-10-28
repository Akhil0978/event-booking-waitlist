import { useCallback, useEffect, useRef, useState } from "react";
import { authRequest } from "./authApi.js";
import "./AuthPanel.css";

export default function AuthPanel({ disabled, onBusyChange, onSessionChange }) {
  const [session, setSession] = useState({
    loading: true,
    user: null,
    error: "",
  });
  const [reload, setReload] = useState(0);
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const pending = useRef(false);
  const locked = disabled || busy || session.loading;

  const updateSession = useCallback((value) => {
    setSession(value);
    onSessionChange(value);
  }, [onSessionChange]);

  useEffect(() => {
    const controller = new AbortController();

    authRequest("me", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          updateSession({ loading: false, user: data.user, error: "" });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          updateSession({
            loading: false,
            user: null,
            error: error instanceof TypeError
              ? "Could not connect. Check that the backend is running."
              : error.message,
          });
        }
      });

    return () => controller.abort();
  }, [reload, updateSession]);

  async function changeSession(endpoint, body, form) {
    if (locked || pending.current) return;

    pending.current = true;
    setBusy(true);
    setNotice(null);
    onBusyChange(true);

    try {
      const data = await authRequest(endpoint, { body });

      updateSession({
        loading: false,
        user: endpoint === "logout" ? null : data.user,
        error: "",
      });

      setMode("login");
      form?.reset();

      setNotice({
        type: "success",
        text: endpoint === "signup"
          ? "Account created. You are logged in."
          : endpoint === "logout"
            ? "Logged out."
            : "Logged in successfully.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof TypeError
          ? "Connection interrupted. Refresh the page to check your login status."
          : error.message,
      });
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (locked || pending.current) return;

    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const email = String(values.get("email") || "").trim().toLowerCase();
    const password = String(values.get("password") || "");

    if (mode === "signup" && !name) {
      setNotice({ type: "error", text: "Enter your name." });
      return;
    }

    if (mode === "signup" && [...password].length < 15) {
      setNotice({
        type: "error",
        text: "Use a password with at least 15 characters.",
      });
      return;
    }

    if (new TextEncoder().encode(password).length > 72) {
      setNotice({
        type: "error",
        text: "Password is too long. Try a shorter passphrase.",
      });
      return;
    }

    changeSession(mode, {
      email,
      password,
      ...(mode === "signup" ? { name } : {}),
    }, form);
  }

  return (
    <section
      className="auth-panel"
      aria-labelledby="auth-heading"
      aria-busy={busy || session.loading}
    >
      <div className="auth-top">
        <h2 id="auth-heading">Your account</h2>

        {!session.loading && !session.error && !session.user && (
          <button
            type="button"
            className="auth-outline"
            disabled={locked}
            onClick={() => {
              setMode((value) => value === "login" ? "signup" : "login");
              setNotice(null);
            }}
          >
            {mode === "login" ? "Create account" : "Back to login"}
          </button>
        )}
      </div>

      {session.loading && <p role="status">Checking login...</p>}

      {!session.loading && session.error && (
        <div>
          <p className="auth-message error" role="alert">
            {session.error}
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              updateSession({ loading: true, user: null, error: "" });
              setReload((value) => value + 1);
            }}
          >
            Retry connection
          </button>
        </div>
      )}

      {!session.loading && !session.error && session.user && (
        <div className="auth-account">
          <div>
            <strong>Signed in as {session.user.name}</strong>
            <p className="auth-help">{session.user.email}</p>
          </div>

          <button
            type="button"
            disabled={locked}
            onClick={() => changeSession("logout")}
          >
            {busy ? "Please wait..." : "Log out"}
          </button>
        </div>
      )}

      {!session.loading && !session.error && !session.user && (
        <form
          key={mode}
          onSubmit={handleSubmit}
          onChange={() => setNotice(null)}
        >
          <fieldset disabled={locked}>
            <legend>
              {mode === "signup" ? "Create your account" : "Log in"}
            </legend>

            <div className={"auth-fields " + mode}>
              {mode === "signup" && (
                <label>
                  Full name
                  <input
                    name="name"
                    autoComplete="name"
                    maxLength={100}
                    required
                  />
                </label>
              )}

              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  maxLength={254}
                  required
                />
              </label>

              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  minLength={mode === "signup" ? 15 : undefined}
                  maxLength={72}
                  aria-describedby={mode === "signup" ? "auth-password-help" : undefined}
                  required
                />
              </label>
            </div>

            {mode === "signup" && (
              <p className="auth-help" id="auth-password-help">
                Use at least 15 characters. A few words work well.
              </p>
            )}

            <button type="submit" disabled={locked}>
              {busy
                ? "Please wait..."
                : mode === "signup" ? "Sign up" : "Log in"}
            </button>
          </fieldset>
        </form>
      )}

      {notice && (
        <p
          className={"auth-message " + notice.type}
          role={notice.type === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
