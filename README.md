# Talgarclean

Это диспетчерская панель для заявок из Telegram и ручного создания точек.
Сейчас проект работает на React + Express, а данные хранятся в PostgreSQL. Для месячной беты вход разделён: диспетчер входит отдельно, и каждая машина входит отдельно по своему госномеру и паролю.

## Как подключить базу данных

Для рабочей версии лучше всего использовать PostgreSQL.

### 1. Что поставить

- PostgreSQL 15+.
- Любой клиент для БД, например `psql`, DBeaver или TablePlus.

### 2. Что добавить в `.env`

Создай файл `.env` по образцу `.env.example` и укажи:

```env
PORT=3001
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/talgarclean
AUTH_SECRET=change_me_for_beta
DISPATCHER_LOGIN=dispatcher
DISPATCHER_PASSWORD=dispatcher123
```

### 3. Что создать в БД

В проект уже добавлены:

- `[server/db/schema.sql](/Users/ruslanzlobin/Downloads/Talgarclean-main/server/db/schema.sql)`
- `[server/db/seed.sql](/Users/ruslanzlobin/Downloads/Talgarclean-main/server/db/seed.sql)`

Сначала выполни схему, потом seed:

```bash
npm install
psql "$DATABASE_URL" -f server/db/schema.sql
psql "$DATABASE_URL" -f server/db/seed.sql
```

### 4. Как теперь устроен вход

- Диспетчер входит по `DISPATCHER_LOGIN` и `DISPATCHER_PASSWORD`.
- Водитель входит по госномеру машины.
- Пароль водителю задаёт диспетчер при создании машины.
- В этой бете доступно только 4 машины.

### 5. Как отправлять фото в Яндекс Диск

Для беты сейчас добавлен серверный архив фото в Яндекс Диск.

Добавь в `.env`:

```env
PHOTO_ARCHIVE_PROVIDER=yandex
YANDEX_DISK_TOKEN=your_yandex_oauth_token
YANDEX_DISK_BASE_PATH=disk:/Talgarclean/photos
```

После этого фото `до` и `после` будут:

- сохраняться в интерфейсе как раньше
- дополнительно отправляться на Яндекс Диск
- раскладываться по папкам даты и заявки

Если архив в Яндекс Диск включён и загрузка не удалась, сохранение фото вернёт ошибку, чтобы водитель не думал, что фото уже ушло в облако.

### 6. Что именно хранить

Минимальный набор таблиц:

- `drivers` - машины и их логины.
- `tasks` - заявки.
- `bot_state` - `lastTelegramUpdateId` и время последнего сообщения бота.

### 7. Что хранить в `tasks`

- адрес
- координаты
- комментарий
- назначенный экипаж
- порядок маршрута
- статус
- фото до/после
- время старта и завершения
- источник заявки
- данные отправителя Telegram

Фото теперь сохраняются на сервере в `server/uploads`, а в базе лежат только ссылки вида `/api/uploads/...`.

### 8. Что делать дальше в коде

Потом нужно заменить `server/store.js` на слой работы с БД.
Фронт менять почти не придется, если API сохранит тот же формат ответа:

- `drivers`
- `tasks`
- `bot`

## Локальный запуск

```bash
npm install
npm run dev
```

## Структура

- `src/` - React интерфейс.
- `server/` - Express API и Telegram-бот.
- `server/db/` - схема и seed для PostgreSQL.
