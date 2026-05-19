function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUserLabel(user) {
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return fullName || user?.username || "Пользователь";
}

function parseTelegramPayload(message) {
  if (message.location) {
    return {
      address: message.text?.trim() || `Геолокация от ${getUserLabel(message.from)}`,
      comment: "Получена геолокация из Telegram",
      lat: message.location.latitude,
      lon: message.location.longitude,
    };
  }

  const text = message.text?.trim();

  if (!text || text.startsWith("/")) {
    return null;
  }

  const [address, ...rest] = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!address) {
    return null;
  }

  return {
    address,
    comment: rest.join(" ") || `Заявка из Telegram от ${getUserLabel(message.from)}`,
    lat: null,
    lon: null,
  };
}

async function callTelegramApi(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram API returned an error.");
  }

  return data.result;
}

export function startTelegramBot({
  token,
  getLastUpdateId,
  onTaskReceived,
  onUpdateHandled,
  logger = console,
}) {
  const status = {
    configured: Boolean(token),
    running: false,
    lastMessageAt: null,
    lastError: null,
  };

  if (!token) {
    logger.warn("Telegram bot token is not configured. Bot polling is disabled.");

    return {
      stop() {},
      getStatus() {
        return { ...status };
      },
    };
  }

  let stopped = false;

  async function sendMessage(chatId, text) {
    try {
      await callTelegramApi(token, "sendMessage", {
        chat_id: chatId,
        text,
      });
    } catch (error) {
      logger.error("Failed to send Telegram message:", error);
    }
  }

  async function handleMessage(update) {
    const message = update.message || update.edited_message;

    if (!message) {
      await onUpdateHandled(update.update_id);
      return;
    }

    if (message.text?.startsWith("/start") || message.text?.startsWith("/help")) {
      await onUpdateHandled(update.update_id);
      await sendMessage(
        message.chat.id,
        "Отправь адрес точки одним сообщением. Можно добавить комментарий со второй строки или прислать геолокацию."
      );
      return;
    }

    const parsedPayload = parseTelegramPayload(message);

    if (!parsedPayload) {
      await onUpdateHandled(update.update_id);
      await sendMessage(
        message.chat.id,
        "Не удалось распознать заявку. Отправь адрес текстом или прикрепи геолокацию."
      );
      return;
    }

    await onTaskReceived(update.update_id, {
      ...parsedPayload,
      reporterName: getUserLabel(message.from),
      reporterUsername: message.from?.username || "",
      reporterChatId: message.chat.id,
    });

    status.lastMessageAt = new Date().toISOString();
    await sendMessage(
      message.chat.id,
      `Заявка принята: ${parsedPayload.address}. Диспетчер увидит ее в очереди и назначит маршрут.`
    );
  }

  async function poll() {
    status.running = true;
    let offset = (await getLastUpdateId()) + 1;

    while (!stopped) {
      try {
        const updates = await callTelegramApi(token, "getUpdates", {
          offset,
          timeout: 25,
          allowed_updates: ["message", "edited_message"],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          await handleMessage(update);
        }

        status.lastError = null;
      } catch (error) {
        status.lastError = error.message;
        logger.error("Telegram polling failed:", error);
        await wait(3000);
      }
    }

    status.running = false;
  }

  poll();

  return {
    stop() {
      stopped = true;
    },
    getStatus() {
      return { ...status };
    },
  };
}
