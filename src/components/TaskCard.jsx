import {
  formatDate,
  getStatusText,
  getSourceText,
} from "../utils/taskHelpers";

export default function TaskCard({ task, driverLabel, onReset, onUpdate }) {
  const isCompleted = task.status === "completed";
  const canFinishTask =
    !isCompleted && Boolean(task.startedAt && task.beforePhoto && task.afterPhoto);
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

  const handleBefore = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      onUpdate(task.id, { beforePhoto: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const handleAfter = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      onUpdate(task.id, { afterPhoto: reader.result });
    };
    reader.readAsDataURL(file);
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
          <div className="photo-box-head">
            <h4>Фото до</h4>
            {task.beforePhoto ? <span className="photo-flag ready">Готово</span> : null}
          </div>
          <input
            className="file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleBefore}
            disabled={isCompleted}
          />
          {task.beforePhoto ? (
            <img className="photo-preview" src={task.beforePhoto} alt="Фото до" />
          ) : (
            <div className="photo-empty">Фото не загружено</div>
          )}
        </div>

        <div className="photo-box">
          <div className="photo-box-head">
            <h4>Фото после</h4>
            {task.afterPhoto ? <span className="photo-flag ready">Готово</span> : null}
          </div>
          <input
            className="file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleAfter}
            disabled={isCompleted}
          />
          {task.afterPhoto ? (
            <img className="photo-preview" src={task.afterPhoto} alt="Фото после" />
          ) : (
            <div className="photo-empty">Фото не загружено</div>
          )}
        </div>
      </div>

      <div className="footer-row">
        <button
          type="button"
          className="btn success"
          onClick={handleFinish}
          disabled={!canFinishTask}
        >
          Завершить задачу
        </button>
        <button type="button" className="btn reset" onClick={handleReset}>
          Сбросить
        </button>
      </div>
    </article>
  );
}
