import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import TaskCard from "./TaskCard";
import { sortDriverTasks } from "../utils/taskHelpers";

const LOCATION_PUSH_INTERVAL_MS = 10_000;
const QUICK_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 20_000,
};
const LIVE_GEOLOCATION_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 20_000,
};

function getTrackingLabel(state) {
  if (state === "live") {
    return "Геолокация активна";
  }

  if (state === "warming") {
    return "Уточняю GPS";
  }

  if (state === "cached") {
    return "Показываю последнюю точку";
  }

  if (state === "requesting") {
    return "Запрашиваю GPS";
  }

  if (state === "denied") {
    return "Нет доступа к GPS";
  }

  if (state === "unsupported") {
    return "Браузер без геолокации";
  }

  if (state === "error") {
    return "GPS недоступен";
  }

  return "GPS не включен";
}

function getTrackingMessage(error) {
  if (error?.code === 1) {
    return "Разреши доступ к геолокации, чтобы диспетчер видел машину на карте.";
  }

  if (error?.code === 2) {
    return "Не удалось определить позицию машины. Проверь связь и GPS.";
  }

  if (error?.code === 3) {
    return "Не удалось получить местоположение. Убедись что геолокация разрешена в настройках браузера и включён Wi-Fi или мобильный интернет.";
  }

  return error?.message || "Не удалось обновить геопозицию машины.";
}

function formatLocation(value) {
  if (!value) {
    return "Координаты ещё не получены";
  }

  return `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}`;
}

function toPositionPayload(value) {
  if (!value) {
    return null;
  }

  return {
    lat: value.lat,
    lon: value.lon,
    accuracy: value.accuracy,
    heading: value.heading,
    speed: value.speed,
  };
}

export default function DriverPanel({
  tasks,
  drivers,
  fleet,
  lockedDriverName = "",
  onUpdateTask,
  onResetTask,
  onUpdateDriverLocation,
}) {
  const [selectedDriver, setSelectedDriver] = useState(lockedDriverName || drivers[0] || "");
  const [trackingState, setTrackingState] = useState("idle");
  const [trackingError, setTrackingError] = useState("");
  const [currentPosition, setCurrentPosition] = useState(null);
  const currentPositionRef = useRef(null);
  const lastPushAtRef = useRef(0);
  const hasGeolocation =
    typeof navigator !== "undefined" && "geolocation" in navigator;
  const activeDriver = lockedDriverName || (drivers.includes(selectedDriver) ? selectedDriver : drivers[0] || "");
  const activeFleet = useMemo(
    () => fleet.find((item) => item.name === activeDriver) || null,
    [activeDriver, fleet]
  );
  const serverPosition = useMemo(
    () => toPositionPayload(activeFleet?.lastLocation),
    [activeFleet]
  );
  const driverTasks = sortDriverTasks(
    tasks.filter((task) => task.assignedDriver === activeDriver)
  );
  const displayedPosition = currentPosition || serverPosition;
  const effectiveTrackingState = !hasGeolocation
    ? "unsupported"
    : trackingState === "denied"
      ? "denied"
      : trackingState === "error" && !displayedPosition
        ? "error"
        : currentPosition
          ? "live"
          : activeDriver && displayedPosition
            ? "warming"
            : activeDriver
              ? "requesting"
              : "idle";
  const pendingCount = driverTasks.filter((task) => task.status === "pending").length;
  const inProgressCount = driverTasks.filter(
    (task) => task.status === "in_progress"
  ).length;
  const completedCount = driverTasks.filter((task) => task.status === "completed").length;

  const reportLocation = useEffectEvent(async (payload) => {
    try {
      await onUpdateDriverLocation(activeDriver, payload);
      setTrackingError("");
    } catch (error) {
      setTrackingError(error.message);
    }
  });

  const applyPosition = useEffectEvent((payload, nextState = "live") => {
    currentPositionRef.current = payload;
    setCurrentPosition(payload);
    setTrackingState(nextState);
  });

  const pushLocationIfDue = useEffectEvent((payload) => {
    if (Date.now() - lastPushAtRef.current < LOCATION_PUSH_INTERVAL_MS) {
      return;
    }

    lastPushAtRef.current = Date.now();
    reportLocation(payload);
  });

  useEffect(() => {
    lastPushAtRef.current = 0;
    currentPositionRef.current = null;
  }, [activeDriver]);

  useEffect(() => {
    if (!activeDriver || !hasGeolocation) {
      return undefined;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const payload = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading:
            position.coords.heading === null ? null : Number(position.coords.heading),
          speed: position.coords.speed === null ? null : Number(position.coords.speed),
        };

        applyPosition(payload);
        pushLocationIfDue(payload);
      },
      (error) => {
        if (error?.code === 1) {
          setTrackingState("denied");
          setTrackingError(getTrackingMessage(error));
          return;
        }

        if (!(currentPositionRef.current || serverPosition)) {
          setTrackingState("error");
          setTrackingError(getTrackingMessage(error));
        }
      },
      QUICK_GEOLOCATION_OPTIONS
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const payload = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading:
            position.coords.heading === null ? null : Number(position.coords.heading),
          speed: position.coords.speed === null ? null : Number(position.coords.speed),
        };

        applyPosition(payload);
        pushLocationIfDue(payload);
      },
      (error) => {
        if (error?.code === 1) {
          setTrackingState("denied");
          setTrackingError(getTrackingMessage(error));
          return;
        }

        if (!(currentPositionRef.current || serverPosition)) {
          setTrackingState("error");
        }

        setTrackingError(getTrackingMessage(error));
      },
      LIVE_GEOLOCATION_OPTIONS
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [activeDriver, hasGeolocation, serverPosition]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Режим водителя</p>
          <h2>Маршрутный лист, GPS и фотоотчет</h2>
          <p className="panel-copy">
            Водитель видит только свои заявки, делает фото до и после, а диспетчер
            получает GPS выбранной машины в реальном времени.
          </p>
        </div>

        {lockedDriverName ? (
          <div className="field driver-select readonly-select">
            <span>Текущая машина</span>
            <strong>{activeFleet?.plateNumber || activeDriver || "—"}</strong>
          </div>
        ) : (
          <label className="field driver-select">
            <span>Выбранный водитель</span>
            <select
              value={activeDriver}
              onChange={(event) => {
                setSelectedDriver(event.target.value);
                setTrackingState("idle");
                setTrackingError("");
                setCurrentPosition(null);
              }}
            >
              {drivers.map((driver) => (
                <option key={driver} value={driver}>
                  {fleet.find((item) => item.name === driver)?.plateNumber || driver}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="driver-status-bar">
        <span
          className={`fleet-status ${
            ["live", "warming", "cached"].includes(effectiveTrackingState)
              ? "live"
              : "offline"
          }`}
        >
          {getTrackingLabel(effectiveTrackingState)}
        </span>
        <span className="metric-badge">
          Госномер: {activeFleet?.plateNumber || "не указан"}
        </span>
        <span className="metric-badge">GPS: {formatLocation(displayedPosition)}</span>
      </div>

      {trackingError ? <div className="message-banner warning">{trackingError}</div> : null}

      <div className="driver-stats">
        <div className="overview-card compact-card">
          <span>Назначено</span>
          <strong>{driverTasks.length}</strong>
        </div>
        <div className="overview-card compact-card">
          <span>Ожидают</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="overview-card compact-card">
          <span>В работе</span>
          <strong>{inProgressCount}</strong>
        </div>
        <div className="overview-card compact-card">
          <span>Завершено</span>
          <strong>{completedCount}</strong>
        </div>
      </div>

      <div className="task-list">
        {driverTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            driverLabel={activeFleet?.plateNumber || task.assignedDriver}
            onReset={onResetTask}
            onUpdate={onUpdateTask}
          />
        ))}
      </div>

      {!driverTasks.length ? (
        <div className="empty-state">
          Для этой машины пока нет заявок. Диспетчер должен назначить их в панели.
        </div>
      ) : null}
    </section>
  );
}
