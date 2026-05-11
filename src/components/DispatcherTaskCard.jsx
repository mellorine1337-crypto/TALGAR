import { useEffect, useMemo, useState } from "react";
import {
  formatDate,
  getReporterText,
  getSourceText,
  getStatusText,
  STATUS_OPTIONS,
} from "../utils/taskHelpers";

function toDraft(task) {
  return {
    address: task.address,
    comment: task.comment || "",
    assignedDriver: task.assignedDriver || "",
    routeOrder: task.routeOrder ?? "",
    status: task.status,
  };
}

function normalizeComparableDraft(draft) {
  return JSON.stringify({
    ...draft,
    routeOrder: draft.routeOrder === "" ? "" : String(draft.routeOrder),
  });
}

export default function DispatcherTaskCard({
  task,
  drivers,
  driverLabels = {},
  onSave,
  onResetTask,
  onDeleteTask,
}) {
  const [draft, setDraft] = useState(() => toDraft(task));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const assignedDriverLabel = driverLabels[task.assignedDriver] || task.assignedDriver;

  const isDirty = useMemo(
    () => normalizeComparableDraft(draft) !== normalizeComparableDraft(toDraft(task)),
    [draft, task]
  );

  useEffect(() => {
    if (!isDirty) {
      setDraft(toDraft(task));
      setSaveError("");
    }
  }, [isDirty, task]);

  const handleFieldChange = (field) => (event) => {
    setDraft((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleSave = async () => {
    const address = draft.address.trim();
    const comment = draft.comment.trim();
    const routeInput = String(draft.routeOrder).trim();

    if (!address) {
      setSaveError("Адрес не может быть пустым.");
      return;
    }

    let routeOrder = null;

    if (draft.assignedDriver) {
      if (routeInput) {
        routeOrder = Number(routeInput);

        if (!Number.isInteger(routeOrder) || routeOrder < 1) {
          setSaveError("Порядок точки должен быть положительным числом.");
          return;
        }
      }
    }

    setSaving(true);
    setSaveError("");

    try {
      await onSave(task.id, {
        address,
        comment,
        assignedDriver: draft.assignedDriver,
        routeOrder,
        status: draft.status,
      });
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Удалить заявку по адресу «${task.address}»?`)) {
      return;
    }

    try {
      await onDeleteTask(task.id);
    } catch (error) {
      setSaveError(error.message);
    }
  };

  return (
    <article className={`dispatch-card ${task.status}`}>
      <div className="dispatch-top">
        <div>
          <div className="ticket-row">
            <p className="dispatch-ticket">Заявка #{String(task.id).slice(-6)}</p>
            <span className={`source-chip ${task.source}`}>{getSourceText(task.source)}</span>
            {task.routeOrder ? (
              <span className="route-badge">Точка маршрута #{task.routeOrder}</span>
            ) : null}
          </div>
          <h3>{task.address}</h3>
          <p className="dispatch-comment">
            {task.comment || "Комментарий для водителя не указан"}
          </p>
          <p className="dispatch-origin">{getReporterText(task)}</p>
        </div>

        <span className={`status-badge ${task.status}`}>{getStatusText(task.status)}</span>
      </div>

      <div className="meta-grid">
        <div className="meta-box">
          <span>Назначен</span>
          <strong>{assignedDriverLabel || "Не назначен"}</strong>
        </div>
        <div className="meta-box">
          <span>Создана</span>
          <strong>{formatDate(task.createdAt)}</strong>
        </div>
        <div className="meta-box">
          <span>Старт</span>
          <strong>{formatDate(task.startedAt)}</strong>
        </div>
        <div className="meta-box">
          <span>Завершение</span>
          <strong>{formatDate(task.finishedAt)}</strong>
        </div>
      </div>

      <div className="dispatch-form-grid">
        <label className="field">
          <span>Адрес</span>
          <input value={draft.address} onChange={handleFieldChange("address")} />
        </label>

        <label className="field">
          <span>Водитель</span>
          <select
            value={draft.assignedDriver}
            onChange={handleFieldChange("assignedDriver")}
          >
            <option value="">Не назначен</option>
            {drivers.map((driver) => (
              <option key={driver} value={driver}>
                {driverLabels[driver] || driver}
              </option>
              ))}
          </select>
        </label>

        <label className="field">
          <span>Статус</span>
          <select value={draft.status} onChange={handleFieldChange("status")}>
            {STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Порядок в маршруте</span>
          <input
            value={draft.routeOrder}
            onChange={handleFieldChange("routeOrder")}
            placeholder={draft.assignedDriver ? "1" : "Назначь водителя"}
            disabled={!draft.assignedDriver}
          />
        </label>

        <label className="field dispatch-form-full">
          <span>Комментарий</span>
          <textarea
            rows="3"
            value={draft.comment}
            onChange={handleFieldChange("comment")}
          />
        </label>
      </div>

      <div className="photo-strip">
        <div className={`photo-flag ${task.beforePhoto ? "ready" : ""}`}>
          Фото до {task.beforePhoto ? "загружено" : "не загружено"}
        </div>
        <div className={`photo-flag ${task.afterPhoto ? "ready" : ""}`}>
          Фото после {task.afterPhoto ? "загружено" : "не загружено"}
        </div>
      </div>

      {(task.beforePhoto || task.afterPhoto) && (
        <div className="dispatch-photo-grid">
          <div className="dispatch-photo-box">
            {task.beforePhoto ? (
              <img src={task.beforePhoto} alt="Фото до" className="dispatch-photo" />
            ) : (
              <div className="photo-empty small">Фото до отсутствует</div>
            )}
          </div>
          <div className="dispatch-photo-box">
            {task.afterPhoto ? (
              <img src={task.afterPhoto} alt="Фото после" className="dispatch-photo" />
            ) : (
              <div className="photo-empty small">Фото после отсутствует</div>
            )}
          </div>
        </div>
      )}

      {saveError ? <p className="form-error">{saveError}</p> : null}

      <div className="dispatch-actions">
        <div className="inline-actions">
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
          <button
            type="button"
            className="btn reset"
            onClick={async () => {
              try {
                await onResetTask(task.id);
              } catch (error) {
                setSaveError(error.message);
              }
            }}
          >
            Сбросить цикл
          </button>
          <button type="button" className="btn danger" onClick={handleDelete}>
            Удалить
          </button>
        </div>
      </div>
    </article>
  );
}
