import "dotenv/config";

export type TelegramConfig = {
  token: string;
  chatId: string;
};

export function resolveTelegramConfig(): TelegramConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const missing = [
    token ? undefined : "TELEGRAM_BOT_TOKEN",
    chatId ? undefined : "TELEGRAM_CHAT_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. The token comes from @BotFather; the chat id from ` +
        "https://api.telegram.org/bot<token>/getUpdates after messaging the bot once.",
    );
  }

  return { token: token!, chatId: chatId! };
}

/** Turns a failed Telegram response into a message that says what to do next. */
export function describeTelegramError(status: number, body: string): Error {
  if (/chat not found/i.test(body)) {
    return new Error(
      "Telegram does not know this chat. Send the bot a message once, then read the id from " +
        "getUpdates — a bot cannot open a conversation on its own.",
    );
  }

  if (status === 401) {
    return new Error("Telegram rejected the bot token (401). It may have been revoked.");
  }

  return new Error(`Telegram request failed (${status}): ${body.slice(0, 300)}`);
}

/**
 * Announces the finished video.
 *
 * Plain text rather than Markdown or HTML: a title is written by a model and
 * may contain an underscore or a bracket, which either parse mode would treat
 * as formatting and reject the whole message over.
 */
export async function sendMessage(text: string, config = resolveTelegramConfig()): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    throw describeTelegramError(response.status, await response.text());
  }
}
