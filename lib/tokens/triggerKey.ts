// lib/tokens/triggerKey.ts
import { createHash } from "crypto";

type Source = "ca" | "ticker" | "phrase" | "hashtag" | "upper" | "llm";

const normTicker = (s: string) => {
  let x = (s || "").trim();
  if (!x) return "";
  x = x.replace(/^[#$]/, "");
  return `$${x}`.toLowerCase();
};
const normCA = (s: string) => (s || "").trim().toLowerCase();
export const normalizePhrase = (s: string) =>
  (s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 256);

export function buildTriggerKeyWithText(input: {
  source: Source;
  value: string;
}) {
  switch (input.source) {
    case "ticker":
    case "upper":
    case "hashtag": {
      const txt = normTicker(input.value);
      return { key: `ticker:${txt}`, text: txt };
    }
    case "ca": {
      const txt = normCA(input.value);
      return { key: `ca:${txt}`, text: txt };
    }
    case "phrase":
    case "llm": {
      const norm = normalizePhrase(input.value);
      const key = "phrase:" + createHash("sha1").update(norm).digest("hex");
      return { key, text: norm };
    }
    default: {
      const norm = normalizePhrase(input.value);
      return {
        key: "unknown:" + createHash("sha1").update(norm).digest("hex"),
        text: norm,
      };
    }
  }
}

export const buildTriggerKey = (input: { source: Source; value: string }) =>
  buildTriggerKeyWithText(input).key;
