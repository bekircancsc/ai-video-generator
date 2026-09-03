import test from "node:test";
import assert from "node:assert/strict";
import { describeTelegramError, resolveTelegramConfig } from "./telegram";

function withEnv(values: Record<string, string | undefined>, body: () => void) {
  const saved: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("both missing settings are named at once", () => {
  withEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }, () => {
    assert.throws(resolveTelegramConfig, (error: Error) => {
      assert.match(error.message, /TELEGRAM_BOT_TOKEN/);
      assert.match(error.message, /TELEGRAM_CHAT_ID/);
      return true;
    });
  });
});

test("a chat id of zero-looking text is still a chat id", () => {
  withEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "7094098999" }, () => {
    assert.deepEqual(resolveTelegramConfig(), { token: "t", chatId: "7094098999" });
  });
});

test("an unknown chat explains that the bot cannot start the conversation", () => {
  const error = describeTelegramError(400, '{"description":"Bad Request: chat not found"}');

  assert.match(error.message, /cannot open a conversation/);
});

test("a revoked token is reported as such", () => {
  assert.match(describeTelegramError(401, "Unauthorized").message, /revoked/);
});

test("an unrecognised failure keeps the status and the body", () => {
  const error = describeTelegramError(429, "Too Many Requests");

  assert.match(error.message, /429/);
  assert.match(error.message, /Too Many Requests/);
});
