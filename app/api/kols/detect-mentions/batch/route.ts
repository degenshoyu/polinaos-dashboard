// app/api/kols/detect-mentions/batch/route.ts
/* 与 /api/kols/detect-mentions 完全一致的路由壳：
   - 复用 getServerSession + CRON_SECRET 双鉴权
   - 复用同一套 Body schema（screen_name/days/missingOnly/dbLog/stream）
   - 调用同一个 runDetectMentions(params, logger)
   - 支持 NDJSON 流式输出与非流式 JSON
   - 仅做“参数解析 + 流包装”，不在路由内做任何解析/写库/价格回填逻辑
   - 从而确保 coin_ca_ticker 白名单等严格规则由 service 统一生效
*/

import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runDetectMentions } from "@/lib/kols/detectMentionsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 入参与 /api/kols/detect-mentions 完全一致 */
const Body = z.object({
  screen_name: z.string().min(1), // handle or "*" / "all"
  days: z.number().int().min(1).max(30).default(7),
  missingOnly: z.boolean().default(true),
  dbLog: z.boolean().default(false),
  stream: z.boolean().default(false), // stream NDJSON when true
});

/** 与单条路由同款的 CRON secret 放行逻辑 */
function allowByCronSecret(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return false;

  const url = new URL(req.url);
  const q = url.searchParams.get("secret")?.trim() || "";
  const h =
    req.headers.get("x-cron-secret")?.trim() ||
    req.headers.get("x-api-key")?.trim() ||
    "";

  return q === expected || h === expected;
}

/** 统一执行器：根据 wantStream 选择流式或非流式 */
async function execDetect(
  req: Request,
  params: {
    screen_name: string;
    days: number;
    missingOnly: boolean;
    dbLog: boolean;
    stream: boolean;
  },
) {
  // AuthZ: admin session OR cron secret（与单条路由一致）
  const session = await getServerSession(authOptions);
  const isAdmin = Boolean((session?.user as any)?.isAdmin);
  const bySecret = allowByCronSecret(req);
  if (!isAdmin && !bySecret) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const wantStreamQuery =
    url.searchParams.get("stream") === "1" ||
    url.searchParams.get("stream") === "true";
  const wantStream = wantStreamQuery || Boolean(params.stream);

  const svcParams = {
    screen_name: params.screen_name,
    days: params.days,
    missingOnly: params.missingOnly,
    dbLog: params.dbLog,
    origin: url.origin, // 传给 service（与单条路由相同）
  };

  if (wantStream) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          const write = (obj: any) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          const emit = (evt: string, data: any = {}) =>
            write({ t: Date.now(), evt, ...data });

          (async () => {
            try {
              emit("hello");
              const result = await runDetectMentions(svcParams, (e) =>
                typeof e === "object" && e?.event
                  ? emit(e.event, { ...e, event: undefined })
                  : emit("log", { data: e }),
              );
              emit("result", result);
              controller.close();
            } catch (e: any) {
              emit("error", { message: e?.message || String(e) });
              controller.close();
            }
          })();
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  }

  // 非流式
  const result = await runDetectMentions(svcParams, () => {});
  return NextResponse.json(result);
}

/** 兼容 GET（查询串传参） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = {
    screen_name: url.searchParams.get("screen_name") ?? "",
    days: Number(url.searchParams.get("days") ?? "7"),
    missingOnly: /^(1|true)$/i.test(
      url.searchParams.get("missingOnly") ?? "true",
    ),
    dbLog: /^(1|true)$/i.test(url.searchParams.get("dbLog") ?? "false"),
    stream: /^(1|true)$/i.test(url.searchParams.get("stream") ?? "false"),
  };

  // 与 Body schema 对齐的校验（重用 zod 规则）
  const parsed = Body.parse({
    screen_name: q.screen_name,
    days: q.days,
    missingOnly: q.missingOnly,
    dbLog: q.dbLog,
    stream: q.stream,
  });

  return execDetect(req, parsed);
}

/** 与单条路由一致的 POST 入口 */
export async function POST(req: Request) {
  const body = Body.parse(await req.json().catch(() => ({})));
  return execDetect(req, body);
}
