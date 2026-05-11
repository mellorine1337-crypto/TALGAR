import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  clearStoredAuthToken,
  createApi,
  getStoredAuthToken,
  persistAuthToken,
} from "./api/client";
import DispatcherPanel from "./components/DispatcherPanel";
import DriverPanel from "./components/DriverPanel";
import LoginScreen from "./components/LoginScreen";
import { formatDate } from "./utils/taskHelpers";

const POLL_INTERVAL_MS = 4000;
const EMPTY_BOT_STATE = {
  configured: false,
  running: false,
  lastMessageAt: null,
  lastError: null,
};

export default function App() {
  const [authToken, setAuthToken] = useState(() => getStoredAuthToken());
  const [session, setSession] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [botInfo, setBotInfo] = useState(EMPTY_BOT_STATE);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState("");
  const api = useMemo(() => createApi(authToken), [authToken]);
  const isDispatcher = session?.role === "dispatcher";
  const isDriver = session?.role === "driver";

  const applySnapshot = (payload) => {
    setTasks(payload.tasks || []);
    setDrivers(payload.drivers || []);
    setFleet(payload.fleet || []);
    setBotInfo(payload.bot || EMPTY_BOT_STATE);
  };

  useEffect(() => {
    let disposed = false;

    const loadSession = async () => {
      if (!authToken) {
        setLoading(false);
        return;
      }

      try {
        const payload = await api.getSession();

        if (disposed) {
          return;
        }

        setSession(payload.session || null);
        setError("");
      } catch {
        if (!disposed) {
          clearStoredAuthToken();
          setAuthToken("");
          setSession(null);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    loadSession();

    return () => {
      disposed = true;
    };
  }, [api, authToken]);

  useEffect(() => {
    if (!session) {
      setTasks([]);
      setDrivers([]);
      setFleet([]);
      setBotInfo(EMPTY_BOT_STATE);
      return undefined;
    }

    let disposed = false;

    const loadSnapshot = async ({ silent = false } = {}) => {
      try {
        const payload = await api.getBootstrap();

        if (disposed) {
          return;
        }

        applySnapshot(payload);
        setError("");
      } catch (requestError) {
        if (!disposed) {
          setError(requestError.message);
        }
      } finally {
        if (!silent && !disposed) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    loadSnapshot();
    const intervalId = setInterval(() => {
      loadSnapshot({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, [api, session]);

  const runAction = async (action) => {
    try {
      const payload = await action();
      applySnapshot(payload);
      setError("");
      return payload;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    }
  };

  const createTask = (payload) => runAction(() => api.createTask(payload));
  const createDriver = (payload) => runAction(() => api.createDriver(payload));
  const updateDriver = (driverName, patch) =>
    runAction(() => api.updateDriver(driverName, patch));
  const deleteDriver = (driverName) => runAction(() => api.deleteDriver(driverName));
  const updateTask = (taskId, patch) => runAction(() => api.updateTask(taskId, patch));
  const resetTask = (taskId) => runAction(() => api.resetTask(taskId));
  const deleteTask = (taskId) => runAction(() => api.deleteTask(taskId));
  const updateDriverLocation = (driverName, payload) =>
    api.updateDriverLocation(driverName, payload);

  const handleLogin = async (payload) => {
    setLoginLoading(true);
    setError("");

    try {
      const authApi = createApi();
      const result = await authApi.login(payload);
      setLoading(true);
      persistAuthToken(result.token);
      setAuthToken(result.token);
      setSession(result.session || null);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredAuthToken();
    setAuthToken("");
    setSession(null);
    setTasks([]);
    setDrivers([]);
    setFleet([]);
    setBotInfo(EMPTY_BOT_STATE);
    setError("");
  };

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const activeDriversCount = new Set(tasks.map((task) => task.assignedDriver).filter(Boolean))
    .size;

  if (!session && !loading) {
    return <LoginScreen onLogin={handleLogin} loading={loginLoading} error={error} />;
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="glass-card loading-card">
          <p className="eyebrow">
            {isDriver ? "Driver Access" : "Dispatcher Access"}
          </p>
          <h1>Подключение к серверу</h1>
          <p className="lead">
            {isDriver
              ? "Проверяю маршрут водителя, фото и GPS."
              : "Загружаю очередь заявок, машины и статус Telegram-бота."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <p className="eyebrow">
            {isDispatcher ? "Dispatcher Access" : "Driver Access"}
          </p>
          <h1>
            {isDispatcher
              ? "Диспетчерская панель Talgarclean"
              : `Водительская панель ${session?.login || ""}`}
          </h1>
          <p className="lead">
            {isDispatcher
              ? "Диспетчер работает с сайтом, видит весь парк и управляет только четырьмя машинами беты."
              : "Водитель видит только свои заявки, фото до/после и свой GPS-статус."}
          </p>
        </div>

        <div className="header-side">
          <div className="status-cluster">
            <span className="metric-badge">
              {isDispatcher
                ? `Диспетчер: ${session?.login || "—"}`
                : `Логин машины: ${session?.login || "—"}`}
            </span>
            {isDispatcher ? (
              <span
                className={`bot-badge ${
                  botInfo.configured && botInfo.running ? "live" : "offline"
                }`}
              >
                {botInfo.configured && botInfo.running
                  ? "Telegram bot подключен"
                  : "Telegram bot не настроен"}
              </span>
            ) : null}
            {isDispatcher && botInfo.lastMessageAt ? (
              <span className="metric-badge">
                Последняя заявка: {formatDate(botInfo.lastMessageAt)}
              </span>
            ) : null}
          </div>

          <button type="button" className="btn reset" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </header>

      {error ? <div className="message-banner error">{error}</div> : null}
      {isDispatcher && !botInfo.configured ? (
        <div className="message-banner warning">
          Чтобы бот начал принимать адреса, заполни `TELEGRAM_BOT_TOKEN` в `.env` и
          перезапусти сервер.
        </div>
      ) : null}

      {isDispatcher ? (
        <>
          <section className="overview-grid">
            <div className="overview-card">
              <span>Всего заявок</span>
              <strong>{tasks.length}</strong>
            </div>
            <div className="overview-card">
              <span>Ожидают</span>
              <strong>{pendingCount}</strong>
            </div>
            <div className="overview-card">
              <span>В работе</span>
              <strong>{inProgressCount}</strong>
            </div>
            <div className="overview-card">
              <span>Завершено</span>
              <strong>{completedCount}</strong>
            </div>
            <div className="overview-card">
              <span>Активных машин</span>
              <strong>{activeDriversCount}</strong>
            </div>
          </section>

          <DispatcherPanel
            tasks={tasks}
            drivers={drivers}
            fleet={fleet}
            botInfo={botInfo}
            onCreateTask={createTask}
            onCreateDriver={createDriver}
            onUpdateDriver={updateDriver}
            onDeleteDriver={deleteDriver}
            onUpdateTask={updateTask}
            onResetTask={resetTask}
            onDeleteTask={deleteTask}
          />
        </>
      ) : (
        <DriverPanel
          tasks={tasks}
          drivers={drivers}
          fleet={fleet}
          lockedDriverName={session?.driverName || ""}
          onUpdateTask={updateTask}
          onResetTask={resetTask}
          onUpdateDriverLocation={updateDriverLocation}
        />
      )}
    </div>
  );
}
