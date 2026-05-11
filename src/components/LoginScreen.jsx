import { useState } from "react";

const MODE_LABELS = {
  dispatcher: {
    eyebrow: "Dispatcher Access",
    title: "Вход диспетчера",
    description:
      "Полный доступ к заявкам, маршрутам, картам и управлению четырьмя машинами.",
    loginHint: "Логин диспетчера",
  },
  driver: {
    eyebrow: "Driver Access",
    title: "Вход водителя",
    description:
      "Каждая машина входит отдельно и видит только свои заявки, фото и GPS-статус.",
    loginHint: "Логин водителя",
  },
};

export default function LoginScreen({ onLogin, loading = false, error = "" }) {
  const [mode, setMode] = useState("dispatcher");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const modeText = MODE_LABELS[mode];

  return (
    <div className="login-shell">
      <section className="login-card">
        <div className="login-copy">
          <p className="eyebrow">{modeText.eyebrow}</p>
          <h1>{modeText.title}</h1>
          <p className="lead">{modeText.description}</p>
        </div>

        <div className="login-mode-switch" aria-label="Выбор роли">
          <button
            type="button"
            className={`view-pill ${mode === "dispatcher" ? "active" : ""}`}
            onClick={() => setMode("dispatcher")}
          >
            Диспетчер
          </button>
          <button
            type="button"
            className={`view-pill ${mode === "driver" ? "active" : ""}`}
            onClick={() => setMode("driver")}
          >
            Водитель
          </button>
        </div>

        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            onLogin({
              role: mode,
              login: login.trim(),
              password,
            });
          }}
        >
          <label className="field">
            <span>{modeText.loginHint}</span>
            <input
              type="text"
              placeholder={mode === "driver" ? "777AAA02" : "dispatcher"}
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
            />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              placeholder="Введите пароль"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {mode === "driver" ? (
            <p className="hint-text">
              Для водителя логином служит госномер машины. Диспетчер задаёт пароль при
              создании машины.
            </p>
          ) : (
            <p className="hint-text">
              Диспетчерский логин и пароль задаются на сервере через `.env`.
            </p>
          )}

          {error ? <div className="message-banner error inline-banner">{error}</div> : null}

          <button type="submit" className="btn primary login-submit" disabled={loading}>
            {loading ? "Проверяю..." : "Войти"}
          </button>
        </form>
      </section>
    </div>
  );
}
