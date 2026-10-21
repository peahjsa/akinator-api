import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AkinatorClient, Answers, Themes } from "akinator-client";
import { randomUUID } from "node:crypto";

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));
app.get("/", (c) => c.json({ status: "ok", service: "NitroArcade Akinator API", engine: "akinator-client" }));

const games = new Map<string, { client: AkinatorClient; touched: number }>();
const lifetime = 30 * 60 * 1000;
function cleanGames() {
  const now = Date.now();
  for (const [id, game] of games) if (now - game.touched > lifetime) games.delete(id);
}
function resultOf(id: string, client: AkinatorClient, result: any) {
  return {
    ok: true,
    result: {
      id,
      question: result.question,
      answers: result.answers,
      step: result.step,
      progress: result.progression,
      progression: result.progression,
      won: result.won,
      ko: result.ko,
      guess: result.won ? client.winResult : null
    }
  };
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
const choices: Record<string, Answers> = {
  "0": Answers.Yes, "yes": Answers.Yes, "y": Answers.Yes,
  "1": Answers.No, "no": Answers.No, "n": Answers.No,
  "2": Answers.IDontKnow, "idk": Answers.IDontKnow, "idontknow": Answers.IDontKnow, "i don't know": Answers.IDontKnow,
  "3": Answers.Probably, "probably": Answers.Probably, "p": Answers.Probably,
  "4": Answers.ProbablyNot, "probablynot": Answers.ProbablyNot, "probably not": Answers.ProbablyNot, "pn": Answers.ProbablyNot
};
app.get("/diagnose", async (c) => {
  const checks = [];
  for (const host of ["https://en.akinator.com/", "https://en.akinator.com/game"]) {
    try {
      const response = await fetch(host, {
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
        headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0" }
      });
      const html = await response.text();
      checks.push({
        url: host,
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type"),
        title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.slice(0, 120) ?? null,
        hasSession: /name=["']session["']/i.test(html),
        hasSignature: /name=["']signature["']/i.test(html),
        appearsBlocked: /captcha|access denied|forbidden|cloudflare|blocked|challenge/i.test(html.slice(0, 20000))
      });
    } catch (error) {
      checks.push({ url: host, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return c.json({ service: "NitroArcade Akinator", checks });
});
app.post("/start-game", async (c) => {
  try {
    const body = await c.req.json();
    const lang = body.lang ?? "en";
    if (typeof lang !== "string" || !/^[a-z]{2}$/.test(lang)) return c.json({ ok: false, result: { error: "Invalid language" } }, 400);
    const childMode = body.childMode === true || body.childMode === "true";
    cleanGames();
    const client = new AkinatorClient({ language: lang as any, theme: Themes.Character, childMode });
    const first = await client.start();
    const id = randomUUID();
    games.set(id, { client, touched: Date.now() });
    return c.json(resultOf(id, client, first));
  } catch (e) {
    console.error("start-game:", e);
    return c.json({ ok: false, result: { error: errorText(e) } }, 502);
  }
});
app.post("/answer", async (c) => {
  try {
    const body = await c.req.json();
    cleanGames();
    const id = String(body.id ?? "");
    const game = games.get(id);
    if (!game) return c.json({ ok: false, result: { error: "Session expired or not found. Start a new game." } }, 404);
    const answer = choices[String(body.answer ?? "").trim().toLowerCase()];
    if (answer === undefined) return c.json({ ok: false, result: { error: "Invalid answer" } }, 400);
    const next = await game.client.answer(answer);
    game.touched = Date.now();
    return c.json(resultOf(id, game.client, next));
  } catch (e) {
    console.error("answer:", e);
    return c.json({ ok: false, result: { error: errorText(e) } }, 502);
  }
});
app.post("/back", async (c) => {
  try {
    const body = await c.req.json();
    const id = String(body.id ?? "");
    cleanGames();
    const game = games.get(id);
    if (!game) return c.json({ ok: false, result: { error: "Session expired or not found" } }, 404);
    const prev = await game.client.back();
    game.touched = Date.now();
    return c.json(resultOf(id, game.client, prev));
  } catch (e) {
    return c.json({ ok: false, result: { error: errorText(e) } }, 502);
  }
});
const port = Number(process.env.PORT) || 10000;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log("Server is running on port " + port);
