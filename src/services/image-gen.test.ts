import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPollinationsModel,
  defaultTogetherModel,
  describeImageError,
  generateImage,
  resolveImageConfig,
} from "./image-gen";

test("defaults to the keyless provider", () => {
  const config = resolveImageConfig({});
  assert.equal(config.provider, "pollinations");
  assert.equal(config.model, defaultPollinationsModel);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.width, 1080);
  assert.equal(config.height, 1920);
});

test("together needs a key and uses its own default model and size", () => {
  assert.throws(() => resolveImageConfig({ IMAGE_PROVIDER: "together" }), /IMAGE_API_KEY/);

  const config = resolveImageConfig({ IMAGE_PROVIDER: "together", IMAGE_API_KEY: "k" });
  assert.equal(config.model, defaultTogetherModel);
  assert.equal(config.width % 16, 0);
  assert.equal(config.height % 16, 0);
});

test("IMAGE_MODEL overrides the provider default", () => {
  assert.equal(resolveImageConfig({ IMAGE_MODEL: "turbo" }).model, "turbo");
});

test("none is a valid provider", () => {
  assert.equal(resolveImageConfig({ IMAGE_PROVIDER: "none" }).provider, "none");
});

test("an unknown provider names the valid ones", () => {
  assert.throws(() => resolveImageConfig({ IMAGE_PROVIDER: "midjourney" }), /pollinations/);
});

test("error messages say what to do next", () => {
  assert.match(describeImageError("together", 401, "nope").message, /IMAGE_API_KEY/);
  assert.match(describeImageError("pollinations", 429, "slow down").message, /rate limit/i);
  assert.match(describeImageError("pollinations", 500, "boom").message, /500/);
});

async function withFetch(stub: typeof globalThis.fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;

  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("pollinations asks for the image over GET and returns the bytes", async () => {
  let seen = "";

  await withFetch(
    (async (input: any) => {
      seen = String(input);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof globalThis.fetch,
    async () => {
      const bytes = await generateImage("a cold bridge", 42, resolveImageConfig({}));
      assert.deepEqual([...bytes], [1, 2, 3]);
      assert.match(seen, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20cold%20bridge\?/);
      assert.match(seen, /width=1080&height=1920/);
      assert.match(seen, /seed=42/);
    }
  );
});

test("together posts and decodes the base64 image", async () => {
  await withFetch(
    (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("hi").toString("base64") }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch,
    async () => {
      const config = resolveImageConfig({ IMAGE_PROVIDER: "together", IMAGE_API_KEY: "k" });
      const bytes = await generateImage("a cold bridge", 7, config);
      assert.equal(bytes.toString("utf8"), "hi");
    }
  );
});

test("a failed request throws a provider-specific error", async () => {
  await withFetch(
    (async () => new Response("boom", { status: 500 })) as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => generateImage("x", 1, resolveImageConfig({})), /pollinations/);
    }
  );
});

test("an empty body is an error, not an empty image", async () => {
  await withFetch(
    (async () => new Response(new Uint8Array([]), { status: 200 })) as typeof globalThis.fetch,
    async () => {
      await assert.rejects(() => generateImage("x", 1, resolveImageConfig({})), /empty/i);
    }
  );
});

test("generating with the none provider is a programming error", async () => {
  await assert.rejects(
    () => generateImage("x", 1, resolveImageConfig({ IMAGE_PROVIDER: "none" })),
    /none/
  );
});
