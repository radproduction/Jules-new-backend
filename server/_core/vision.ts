import { ENV } from "./env";

/**
 * Looks at a jewellery photo with Claude and returns a short catalogue name and
 * description, so imported products get titles that match their pictures.
 * Uses the Anthropic Messages API directly (no extra npm package).
 */

export type JewelryDescription = {
  name: string;
  description: string;
  metal: "yellow" | "white" | "rose" | "mixed" | "unknown";
  stones: string[];
};

const API_URL = "https://api.anthropic.com/v1/messages";

export function visionConfigured() {
  return !!ENV.anthropicApiKey;
}

const TOOL = {
  name: "record_jewelry",
  description: "Record the catalogue details of the single jewellery piece shown in the photo.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Catalogue title, 2 to 5 words, Title Case, describing what is visible (e.g. 'Emerald Drop Earrings', 'Diamond Tennis Bracelet', 'Polki Bridal Necklace Set', 'Plain Gold Kara'). No brand names, no prices, no karat numbers.",
      },
      description: {
        type: "string",
        description: "One sentence (max 25 words) describing design, stones and finish for a customer catalogue.",
      },
      metal: { type: "string", enum: ["yellow", "white", "rose", "mixed", "unknown"], description: "Colour of the metal." },
      stones: {
        type: "array",
        items: { type: "string" },
        description: "Visible stones in plain words, e.g. ['diamond', 'emerald']. Empty if none.",
      },
    },
    required: ["name", "description", "metal", "stones"],
  },
} as const;

/** One or more photos of the SAME piece (first = main photo); up to 3 are sent. */
export async function describeJewelry(images: string | string[], categoryHint: string): Promise<JewelryDescription> {
  if (!ENV.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const photos = (Array.isArray(images) ? images : [images]).slice(0, 3).map(image => image.replace(/^data:[^;]+;base64,/, ""));
  if (!photos.length) throw new Error("No photo to describe");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": ENV.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ENV.anthropicModel,
        max_tokens: 400,
        system:
          "You catalogue fine jewellery for a Pakistani jeweller (Shaikha Jewellers). Name pieces the way a jeweller's catalogue would. Use terms such as kara, jhumka, tops, polki, kundan, tikka, haar, set only when they fit what you see.",
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              ...photos.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
              {
                type: "text",
                text: `${photos.length > 1 ? `These ${photos.length} photos show the same piece.` : "This photo shows one piece."} They are from the folder "${categoryHint}". Record the piece.`,
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Claude vision failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    }
    const json: any = await response.json();
    const block = (json.content ?? []).find((item: any) => item.type === "tool_use");
    return normalise(block?.input);
  } finally {
    clearTimeout(timer);
  }
}

export function normalise(input: any): JewelryDescription {
  const name = String(input?.name ?? "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!name) throw new Error("Claude returned no name");
  const metals = ["yellow", "white", "rose", "mixed", "unknown"] as const;
  return {
    name,
    description: String(input?.description ?? "").trim().slice(0, 300),
    metal: metals.includes(input?.metal) ? input.metal : "unknown",
    stones: Array.isArray(input?.stones) ? input.stones.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6) : [],
  };
}
