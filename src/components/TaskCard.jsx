import { useRef, useState } from "react";
import {
  formatDate,
  getStatusText,
  getSourceText,
} from "../utils/taskHelpers";

const MAX_PHOTO_WIDTH = 1280;
const JPEG_QUALITY = 0.82;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      if (width > MAX_PHOTO_WIDTH) {
        height = Math.round((height * MAX_PHOTO_WIDTH) / width);
        width = MAX_PHOTO_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось прочитать изображение"));
    };

    img.src = objectUrl;
  });
}

export default function TaskCard({ task, driverLabel, onReset, onUpdate }) {
  const [uploading, setUploading] = useState({ before: false, after: false });
  const beforeInputRef = useRef(null);
  const afterInputRef = useRef(null);
  const isUploading = uploading.before || uploading.after;
  const isCompleted = task.status === "completed";
  const canFinishTask =
    !isCompleted && !isUploading && Boolean(task.startedAt && task.beforePhoto && task.afterPhoto);
  const startButtonLabel =
    task.status === "pending"
      ? "Начать работу"
      : task.status === "completed"
        ? "Задача закрыта"
        : "Маршрут запущен";

  const handleStart = () => {
    if (task.status !== "pending") {
      return;
    }

    onUpdate(task.id, {
      status: "in_progress",
      startedAt: task.startedAt || new Date().toISOString(),
      finishedAt: null,
    });
  };

  const handleBefore = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading((prev) => ({ ...prev, before: true }));
    try {
      const dataUrl = await compressImage(file);
      await onUpdate(task.id, { beforePhoto: dataUrl });
    } catch {
      // error banner shown by App.jsx
    } finally {
      setUploading((prev) => ({ ...prev, before: false }));
      event.target.value = "";
    }
  };

  const handleAfter = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading((prev) => ({ ...prev, after: true }));
    try {
      const dataUrl = await compressImage(file);
      await onUpdate(task.id, { afterPhoto: dataUrl });
    } catch {
      // error banner shown by App.jsx
    } finally {
      setUploading((prev) => ({ ...prev, after: false }));
      event.target.value = "";
    }
  };

  const handleFinish = () => {
    if (!task.startedAt) {
      alert("Сначала нажми «Начать работу»");
      return;
    }

    if (!task.beforePhoto || !task.afterPhoto) {
      alert("Сделай фото до и после");
      return;
    }

    onUpdate(task.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
  };

  const handleReset = () => {
    onReset?.(task.id);
  };

  return (
    <article className={`task-card ${task.status}`}>
      <div className="task-top">
        <div>
          <div className="task-chip-row">
            <p className="task-chip">{driverLabel || task.assignedDriver}</p>
            {task.routeOrder ? (
              <span className="route-badge">Точка #{task.routeOrder}</span>
            ) : null}
            <span className="source-chip driver-source">{getSourceText(task.source)}</span>
          </div>
          <h3 className="task-address">{task.address}</h3>
          <p className="task-comment">{task.comment || "Комментарий не указан"}</p>
        </div>

        <div className={`status-badge ${task.status}`}>{getStatusText(task.status)}</div>
      </div>

      <div className="task-meta">
        <div className="meta-box">
          <span>Создана</span>
          <strong>{formatDate(task.createdAt)}</strong>
        </div>
        <div className="meta-box">
          <span>Время начала</span>
          <strong>{formatDate(task.startedAt)}</strong>
        </div>
        <div className="meta-box">
          <span>Время завершения</span>
          <strong>{formatDate(task.finishedAt)}</strong>
        </div>
      </div>

      <div className="action-row">
        <button
          type="button"
          className="btn primary"
          onClick={handleStart}
          disabled={task.status !== "pending"}
        >
          {startButtonLabel}
        </button>
      </div>

      <div className="photo-grid">
        <div className="photo-box">
          <h4 className="photo-box-title">Фото до</h4>
          {task.beforePhoto ? (
            <img className="photo-preview" src={task.beforePhoto} alt="Фото до" />
          ) : (
            <div className="photo-placeholder">Фото не сделано</div>
          )}
          {!isCompleted && (
            <button
              type="button"
              className={`photo-btn${uploading.before ? " loading" : task.beforePhoto ? " retake" : ""}`}
              onClick={() => beforeInputRef.current?.click()}
              disabled={uploading.before}
            >
              {uploading.before ? "Отправка…" : task.beforePhoto ? "Переснять" : "Сфотографировать"}
            </button>
          )}
          <input
            ref={beforeInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleBefore}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
        </div>

        <div className="photo-box">
          <h4 className="photo-box-title">Фото после</h4>
          {task.afterPhoto ? (
            <img className="photo-preview" src={task.afterPhoto} alt="Фото после" />
          ) : (
            <div className="photo-placeholder">Фото не сделано</div>
          )}
          {!isCompleted && (
            <button
              type="button"
              className={`photo-btn${uploading.after ? " loading" : task.afterPhoto ? " retake" : ""}`}
              onClick={() => afterInputRef.current?.click()}
              disabled={uploading.after}
            >
              {uploading.after ? "Отправка…" : task.afterPhoto ? "Переснять" : "Сфотографировать"}
            </button>
          )}
          <input
            ref={afterInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleAfter}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          />
        </div>
      </div>

      <div className="footer-row">
        <button
          type="button"
          className="btn success"
          onClick={handleFinish}
          disabled={!canFinishTask}
        >
          {isUploading ? "Загрузка фото…" : "Завершить задачу"}
        </button>
        <button type="button" className="btn reset" onClick={handleReset}>
          Сбросить
        </button>
      </div>
    </article>
  );
}
