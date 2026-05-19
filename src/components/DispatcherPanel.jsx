import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import DispatcherFleetMap from "./DispatcherFleetMap";
import DispatcherMapPicker from "./DispatcherMapPicker";
import DispatcherTaskCard from "./DispatcherTaskCard";
import {
  formatDate,
  sortDispatcherTasks,
  STATUS_OPTIONS,
} from "../utils/taskHelpers";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || "";

function formatCoordinateAddress(point) {
  return `Точка ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

function getAddressFromFeature(feature) {
  const properties = feature?.properties || {};

  if (properties.full_address) {
    return properties.full_address;
  }

  const addressParts = [properties.name, properties.place_formatted].filter(Boolean);

  return addressParts.join(", ");
}

function getTodayCompletedCount(tasks) {
  const today = new Date().toLocaleDateString("ru-RU");
  return tasks.filter(
    (task) =>
      task.finishedAt &&
      new Date(task.finishedAt).toLocaleDateString("ru-RU") === today
  ).length;
}

export default function DispatcherPanel({
  tasks,
  drivers,
  fleet,
  botInfo,
  onCreateTask,
  onCreateDriver,
  onUpdateDriver,
  onDeleteDriver,
  onUpdateTask,
  onResetTask,
  onDeleteTask,
}) {
  const [form, setForm] = useState({
    address: "",
    comment: "",
    assignedDriver: "",
    lat: null,
    lon: null,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [formError, setFormError] = useState("");
  const [newDriverPlate, setNewDriverPlate] = useState("");
  const [newDriverPassword, setNewDriverPassword] = useState("");
  const [driverError, setDriverError] = useState("");
  const [driverSaving, setDriverSaving] = useState(false);
  const [addressLookupState, setAddressLookupState] = useState("idle");
  const [plateDrafts, setPlateDrafts] = useState({});
  const [passwordDrafts, setPasswordDrafts] = useState({});
  const [plateSavingDriver, setPlateSavingDriver] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const addressRequestIdRef = useRef(0);
  const fleetByName = useMemo(
    () => new Map(fleet.map((item) => [item.name, item])),
    [fleet]
  );
  const driverLabels = useMemo(
    () =>
      Object.fromEntries(
        drivers.map((driver) => [driver, fleetByName.get(driver)?.plateNumber || driver])
      ),
    [drivers, fleetByName]
  );
  const getDriverLabel = (driver) => driverLabels[driver] || driver;

  const filteredTasks = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();

    return sortDispatcherTasks(tasks).filter((task) => {
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      const matchesDriver =
        driverFilter === "all"
          ? true
          : driverFilter === "unassigned"
            ? !task.assignedDriver
            : task.assignedDriver === driverFilter;
      const haystack = [
        task.address,
        task.comment,
        task.assignedDriver,
        task.reporterName,
        task.reporterUsername,
        task.source,
      ]
        .join(" ")
        .toLowerCase();
      const matchesQuery = !query || haystack.includes(query);

      return matchesStatus && matchesDriver && matchesQuery;
    });
  }, [deferredQuery, driverFilter, statusFilter, tasks]);

  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const unassignedCount = tasks.filter((task) => !task.assignedDriver).length;
  const photoReadyCount = tasks.filter(
    (task) => task.beforePhoto && task.afterPhoto
  ).length;
  const telegramCount = tasks.filter((task) => task.source === "telegram").length;
  const completedTodayCount = getTodayCompletedCount(tasks);
  const onlineFleetCount = fleet.filter((item) => item.isOnline).length;

  useEffect(() => {
    setPlateDrafts((prev) => {
      const next = {};

      for (const driver of drivers) {
        next[driver] = prev[driver] ?? fleetByName.get(driver)?.plateNumber ?? "";
      }

      return next;
    });
  }, [drivers, fleetByName]);

  useEffect(() => {
    setPasswordDrafts((prev) => {
      const next = {};

      for (const driver of drivers) {
        next[driver] = prev[driver] ?? "";
      }

      return next;
    });
  }, [drivers]);

  const handleFieldChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const fallbackAddress = hasSelectedPoint
      ? formatCoordinateAddress({ lat: form.lat, lon: form.lon })
      : "";
    const resolvedAddress = form.address.trim() || fallbackAddress;

    if (!resolvedAddress) {
      setFormError("Укажи адрес точки.");
      return;
    }

    try {
      const payload = {
        address: resolvedAddress,
        comment: form.comment.trim(),
        assignedDriver: form.assignedDriver,
      };

      if (Number.isFinite(form.lat) && Number.isFinite(form.lon)) {
        payload.lat = form.lat;
        payload.lon = form.lon;
      }

      await onCreateTask(payload);

      setForm({
        address: "",
        comment: "",
        assignedDriver: "",
        lat: null,
        lon: null,
      });
      setAddressLookupState("idle");
      setFormError("");
    } catch (error) {
      setFormError(error.message);
    }
  };

  const handleMapPointChange = async (point) => {
    setForm((prev) => ({
      ...prev,
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
    }));

    if (!point) {
      addressRequestIdRef.current += 1;
      setAddressLookupState("idle");
      return;
    }

    if (!MAPBOX_TOKEN) {
      setForm((prev) => ({
        ...prev,
        address: prev.address.trim() || formatCoordinateAddress(point),
      }));
      setAddressLookupState("idle");
      return;
    }

    const requestId = addressRequestIdRef.current + 1;
    addressRequestIdRef.current = requestId;
    setAddressLookupState("loading");

    try {
      const response = await fetch(
        `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${point.lon}&latitude=${point.lat}&types=address,street,place,locality&language=ru&country=KZ&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
      );

      if (!response.ok) {
        throw new Error("Mapbox reverse geocoding failed.");
      }

      const payload = await response.json();
      const address =
        getAddressFromFeature(payload.features?.[0]) || formatCoordinateAddress(point);

      if (addressRequestIdRef.current !== requestId) {
        return;
      }

      setForm((prev) => ({
        ...prev,
        address,
      }));
      setAddressLookupState("resolved");
    } catch {
      if (addressRequestIdRef.current !== requestId) {
        return;
      }

      setForm((prev) => ({
        ...prev,
        address: prev.address.trim() || formatCoordinateAddress(point),
      }));
      setAddressLookupState("error");
    }
  };

  const hasSelectedPoint = Number.isFinite(form.lat) && Number.isFinite(form.lon);

  const handleDriverSubmit = async (event) => {
    event.preventDefault();

    const plateNumber = newDriverPlate.trim().toUpperCase();
    const password = newDriverPassword.trim();

    if (!plateNumber) {
      setDriverError("Укажи госномер водителя.");
      return;
    }

    if (!password) {
      setDriverError("Укажи пароль для водителя.");
      return;
    }

    setDriverSaving(true);
    setDriverError("");

    try {
      await onCreateDriver({ plateNumber, password });
      setNewDriverPlate("");
      setNewDriverPassword("");
    } catch (error) {
      setDriverError(error.message);
    } finally {
      setDriverSaving(false);
    }
  };

  const handleSavePlate = async (driver) => {
    setPlateSavingDriver(driver);
    setDriverError("");

    try {
      await onUpdateDriver(driver, {
        plateNumber: String(plateDrafts[driver] || "").trim().toUpperCase(),
        password: String(passwordDrafts[driver] || "").trim(),
      });
      setPasswordDrafts((prev) => ({
        ...prev,
        [driver]: "",
      }));
    } catch (error) {
      setDriverError(error.message);
    } finally {
      setPlateSavingDriver("");
    }
  };

  const handleDeleteDriver = async (driver) => {
    if (
      !window.confirm(
        `Удалить экипаж «${driver}»? Все заявки этого экипажа станут не назначенными.`
      )
    ) {
      return;
    }

    try {
      await onDeleteDriver(driver);
    } catch (error) {
      setDriverError(error.message);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Диспетчерский режим</p>
          <h2>Очередь заявок и построение маршрутов</h2>
          <p className="panel-copy">
            Все адреса из Telegram и панели попадают сюда. Диспетчер назначает
            экипаж, задает порядок точек и водитель сразу видит маршрут у себя.
          </p>
        </div>

        <div className="panel-badges">
          <span className="metric-badge">Закрыто сегодня: {completedTodayCount}</span>
          <span className="metric-badge">Из Telegram: {telegramCount}</span>
          <span className="metric-badge">Последнее сообщение: {formatDate(botInfo.lastMessageAt)}</span>
        </div>
      </div>

      <div className="dispatcher-layout">
        <form className="glass-card composer-card" onSubmit={handleSubmit}>
          <div className="card-heading">
            <div>
              <p className="card-kicker">Новая заявка</p>
              <h3>Ручное добавление точки</h3>
            </div>
            <span className="card-chip">API</span>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Адрес</span>
              <input
                type="text"
                placeholder="Алматы, Абая 150"
                value={form.address}
                onChange={handleFieldChange("address")}
              />
            </label>

            <label className="field">
              <span>Водитель</span>
              <select
                value={form.assignedDriver}
                onChange={handleFieldChange("assignedDriver")}
              >
                <option value="">Не назначен</option>
                {drivers.map((driver) => (
                  <option key={driver} value={driver}>
                    {getDriverLabel(driver)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span>Комментарий для водителя</span>
            <textarea
              rows="4"
              placeholder="Заезд со двора, контейнер у ворот"
              value={form.comment}
              onChange={handleFieldChange("comment")}
            />
          </label>

          <div className="dispatcher-map-section">
            <div className="map-section-head">
              <div>
                <p className="card-kicker">Карта точки</p>
                <h4>Поставь маркер для навигации</h4>
              </div>

              {hasSelectedPoint ? (
                <button
                  type="button"
                  className="btn reset"
                  onClick={() => handleMapPointChange(null)}
                >
                  Очистить точку
                </button>
              ) : null}
            </div>

            <DispatcherMapPicker
              token={MAPBOX_TOKEN}
              value={{ lat: form.lat, lon: form.lon }}
              onChange={handleMapPointChange}
            />

            <div className="map-footer">
              <span className="hint-text">
                Кликни по карте или перетащи маркер. Адрес подтянется автоматически
                по точке, а координаты сохранятся вместе с заявкой.
              </span>
              <strong className="map-status">
                {hasSelectedPoint
                  ? `Точка выбрана: ${form.lat.toFixed(6)}, ${form.lon.toFixed(6)}`
                  : "Точка пока не выбрана"}
              </strong>
            </div>
            {addressLookupState === "loading" ? (
              <p className="hint-text">Определяю адрес по выбранной точке...</p>
            ) : null}
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}

          <div className="card-actions">
            <button type="submit" className="btn primary">
              Создать заявку
            </button>
            <span className="hint-text">
              Адрес можно ввести руками, а навигационную точку выбрать на карте ниже.
            </span>
          </div>
        </form>

        <aside className="glass-card snapshot-card">
          <div className="card-heading">
            <div>
              <p className="card-kicker">Сводка смены</p>
              <h3>Что происходит сейчас</h3>
            </div>
          </div>

          <div className="snapshot-grid">
            <div className="snapshot-item">
              <span>Ожидают старта</span>
              <strong>{pendingCount}</strong>
            </div>
            <div className="snapshot-item">
              <span>На маршруте</span>
              <strong>{inProgressCount}</strong>
            </div>
            <div className="snapshot-item">
              <span>Закрыты</span>
              <strong>{completedCount}</strong>
            </div>
            <div className="snapshot-item">
              <span>С фото до/после</span>
              <strong>{photoReadyCount}</strong>
            </div>
          </div>

          <div className="crew-list">
            <p className="crew-title">Машины и логины ({drivers.length}/4)</p>
            <div className="crew-row">
              <span>Не назначено</span>
              <strong>{unassignedCount} заявок</strong>
            </div>
            {drivers.map((driver) => {
              const count = tasks.filter((task) => task.assignedDriver === driver).length;
              const fleetItem = fleetByName.get(driver);

              return (
                <div key={driver} className="crew-row">
                  <div className="crew-row-main">
                    <div>
                      <span>{getDriverLabel(driver)}</span>
                      <p className="crew-subline">
                        {fleetItem?.plateNumber
                          ? `Логин: ${fleetItem.loginName || fleetItem.plateNumber} · Пароль: ${
                              fleetItem.hasPassword ? "задан" : "не задан"
                            }`
                          : "Госномер не указан"}
                      </p>
                    </div>
                    <span className={`fleet-status ${fleetItem?.isOnline ? "live" : "offline"}`}>
                      {fleetItem?.isOnline ? "На линии" : "Нет сигнала"}
                    </span>
                  </div>

                  <div className="crew-row-actions">
                    <strong>{count} заявок</strong>
                    <span className="hint-text">
                      Сегодня закрыто: {fleetItem?.completedTodayCount || 0}
                    </span>
                  </div>

                  <div className="crew-row-actions crew-row-edit">
                    <input
                      className="crew-plate-input"
                      type="text"
                      placeholder="Госномер"
                      value={plateDrafts[driver] ?? ""}
                      onChange={(event) =>
                        setPlateDrafts((prev) => ({
                          ...prev,
                          [driver]: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                    <input
                      className="crew-plate-input"
                      type="password"
                      placeholder="Новый пароль"
                      value={passwordDrafts[driver] ?? ""}
                      onChange={(event) =>
                        setPasswordDrafts((prev) => ({
                          ...prev,
                          [driver]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn reset"
                      disabled={plateSavingDriver === driver}
                      onClick={() => handleSavePlate(driver)}
                    >
                      {plateSavingDriver === driver ? "Сохранение..." : "Сохранить номер"}
                    </button>
                    <button
                      type="button"
                      className="btn reset"
                      onClick={() => handleDeleteDriver(driver)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {driverError ? <p className="form-error">{driverError}</p> : null}

          <form className="crew-form" onSubmit={handleDriverSubmit}>
            <div className="form-grid">
              <label className="field compact">
                <span>Госномер машины</span>
                <input
                  type="text"
                  placeholder="777AAA02"
                  value={newDriverPlate}
                  onChange={(event) => setNewDriverPlate(event.target.value.toUpperCase())}
                />
              </label>

              <label className="field compact">
                <span>Пароль водителя</span>
                <input
                  type="password"
                  placeholder="Придумай пароль"
                  value={newDriverPassword}
                  onChange={(event) => setNewDriverPassword(event.target.value)}
                />
              </label>
            </div>

            <div className="card-actions">
              <button type="submit" className="btn primary" disabled={driverSaving}>
                {driverSaving ? "Сохраняю..." : "Добавить машину"}
              </button>
              <span className="hint-text">
                Логин водителя равен госномеру машины. В этой бете доступно только 4 машины.
              </span>
            </div>
          </form>
        </aside>
      </div>

      <div className="glass-card fleet-card">
        <div className="card-heading">
          <div>
            <p className="card-kicker">Автопарк онлайн</p>
            <h3>Где сейчас едут машины</h3>
          </div>
          <span className="metric-badge">На линии: {onlineFleetCount}</span>
        </div>

        <DispatcherFleetMap token={MAPBOX_TOKEN} fleet={fleet} />

        <div className="fleet-grid">
          {fleet.map((item) => (
            <article key={item.name} className="fleet-tile">
              <div className="fleet-tile-top">
                <div>
                  <strong>{item.name}</strong>
                  <p className="fleet-plate">{item.plateNumber || "Без госномера"}</p>
                </div>
                <span className={`fleet-status ${item.isOnline ? "live" : "offline"}`}>
                  {item.isOnline ? "Онлайн" : "Оффлайн"}
                </span>
              </div>

              <div className="fleet-metrics">
                <span>В работе: {item.inProgressCount}</span>
                <span>Ожидают: {item.pendingCount}</span>
                <span>Закрыто сегодня: {item.completedTodayCount}</span>
              </div>

              <p className="fleet-next-task">
                {item.nextTaskAddress
                  ? `Следующая точка: ${item.nextTaskAddress}`
                  : "Активных точек сейчас нет"}
              </p>
              <p className="hint-text">
                Последний сигнал: {formatDate(item.lastSeenAt)}
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="glass-card toolbar-card">
        <div className="toolbar-controls">
          <label className="field compact">
            <span>Поиск</span>
            <input
              type="text"
              placeholder="Адрес, Telegram, комментарий"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <label className="field compact">
            <span>Статус</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Все статусы</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            <span>Водитель</span>
            <select value={driverFilter} onChange={(event) => setDriverFilter(event.target.value)}>
              <option value="all">Все водители</option>
              <option value="unassigned">Не назначено</option>
                {drivers.map((driver) => (
                  <option key={driver} value={driver}>
                    {getDriverLabel(driver)}
                  </option>
                ))}
              </select>
          </label>
        </div>

        <div className="toolbar-summary">
          <strong>{filteredTasks.length}</strong>
          <span>заявок в текущем фильтре</span>
        </div>
      </div>

      <div className="dispatch-list">
        {filteredTasks.map((task) => (
          <DispatcherTaskCard
            key={task.id}
            task={task}
            drivers={drivers}
            driverLabels={driverLabels}
            onSave={onUpdateTask}
            onResetTask={onResetTask}
            onDeleteTask={onDeleteTask}
          />
        ))}
      </div>

      {!filteredTasks.length ? (
        <div className="empty-state">
          По текущим фильтрам заявок нет. Сбрось фильтры или добавь новую точку.
        </div>
      ) : null}
    </section>
  );
}
