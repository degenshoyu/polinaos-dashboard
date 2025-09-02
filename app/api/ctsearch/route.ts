// app/api/ctsearch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { db } from "@/lib/db/client";
import { searches } from "@/lib/db/schema";
import { ensureAnonSessionOn } from "@/lib/cookies/anonSession";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const BASE_URL = process.env.TWITTER_SCANNER_API_URL!;
const BEARER = process.env.TWITTER_SCANNER_SECRET!;

const BodySchema = z
  .object({
    projectName: z.string().optional(),
    twitterHandle: z.string().optional(),
    contractAddress: z.string().optional(),

    screen_name: z.union([z.string(), z.array(z.string())]).optional(),
    keyword: z.union([z.string(), z.array(z.string())]).optional(),

    startDate: z.string().optional(),
    endDate: z.string().optional(),
    maxTweets: z.number().int().min(1).max(500).optional(),
    minFaves: z.number().int().min(0).max(10000).optional(),
  })
  .passthrough();

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return new NextResponse(null, { status: 405 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    projectName,
    twitterHandle,
    contractAddress,
    screen_name,
    keyword,
    startDate,
    endDate,
    minFaves,
  } = parsed.data;

  const session = await getServerSession(authOptions);
  const userId: string | null = (session?.user as any)?.id ?? null;

  let anonSessionId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const write = (msg: string) =>
        controller.enqueue(new TextEncoder().encode(`${msg}\n`));

      try {
        const toArr = (v?: string | string[]) =>
          v == null ? [] : Array.isArray(v) ? v : [v];

        const normHandle = (s: string) => s.trim().replace(/^@+/, "");

        let screenNames: string[] = toArr(screen_name)
          .map(String)
          .map(normHandle);

        if (!screenNames.length && twitterHandle) {
          screenNames = [normHandle(String(twitterHandle))];
        }

        const keywords: string[] = toArr(keyword).map(String);
        if (!keywords.length) {
          if (projectName)
            keywords.push(String(projectName).replaceAll(" ", ""));
          if (contractAddress) keywords.push(String(contractAddress));
          if (!screenNames.length && twitterHandle) {
            keywords.push(normHandle(String(twitterHandle)));
          }
        }

        const today = new Date();
        const startDefault = new Date();
        startDefault.setDate(today.getDate() - 7);
        const endDefault = new Date(today);
        endDefault.setDate(today.getDate() + 1);

        const start_date = startDate ?? startDefault.toISOString().slice(0, 10);
        const end_date = endDate ?? endDefault.toISOString().slice(0, 10);
        const min_faves = minFaves ?? 2;

        if (screenNames.length) {
          write(
            `🔍 Scanning timelines: ${screenNames.map((s) => "@" + s).join(", ")} (${start_date} → ${end_date})`,
          );
        } else {
          write(
            `🔍 Scanning for keywords: ${keywords.join(", ")} (${start_date} → ${end_date})`,
          );
        }

        const body: Record<string, unknown> = {
          start_date,
          end_date,
          min_faves,
        };
        if (screenNames.length) body.screen_name = screenNames;
        if (keywords.length) body.keyword = keywords;

        async function callUpstream(path: string) {
          return fetch(`${BASE_URL}${path}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${BEARER}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        }

        const response = await callUpstream("/search/speed");

        const data = await response.json().catch(() => ({}) as any);

        if (!response.ok || !data?.success) {
          write(
            `❌ Scanner error: ${data?.message || `HTTP ${response.status}`}`,
          );
          controller.close();
          return;
        }

        const jobId: string | undefined = data?.job_id;
        if (!jobId) {
          write("❌ Scanner returned no job_id");
          controller.close();
          return;
        }

        write(`✅ Job started: ${jobId}`);
        write(`📦 Job submitted. You can now begin AI analysis.`);

        try {
          const queryJson = {
            input: {
              projectName,
              twitterHandle,
              contractAddress,
              screen_name: screenNames,
              keyword: keywords,
            },
            scannerRequest: body,
          };

          await db.insert(searches).values({
            userId: userId ?? null,
            anonSessionId: anonSessionId ?? null,
            jobId,
            queryJson,
            source: "ctsearch",
          });

          write("🗂️ Persisted search record.");
        } catch (persistErr) {
          write(`⚠️ Persist failed: ${getErrorMessage(persistErr)}`);
        }
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        write(`❌ Error: ${msg || "Unknown error"}`);
      } finally {
        controller.close();
      }
    },
  });

  const res = new NextResponse(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
    },
  });

  // 匿名会话 cookie
  if (!userId) {
    anonSessionId = await ensureAnonSessionOn(res);
  }

  return res;
}
