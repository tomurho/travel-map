import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";

const MAX_SCREENSHOT_FILES = 10;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const ACCEPTED_SCREENSHOT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type OpenAIExtractionPayload = {
  places?: Array<{
    cityHint?: string;
    countryHint?: string;
    rawName?: string;
    rawText?: string;
  }>;
};

type ErrorStage = "validation" | "openai" | "parse" | "unknown";

class ScreenshotIntakeError extends Error {
  code?: string;
  stage: ErrorStage;
  status: number;

  constructor(
    message: string,
    options: { code?: string; stage: ErrorStage; status?: number },
  ) {
    super(message);
    this.name = "ScreenshotIntakeError";
    this.code = options.code;
    this.stage = options.stage;
    this.status = options.status ?? 500;
  }
}

function logScreenshotIntakeError(error: unknown, context: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error("[screenshot-intake/extract] request failed", {
    ...context,
    message,
    stack,
  });
}

function sanitizeError(error: unknown) {
  if (error instanceof ScreenshotIntakeError) {
    return {
      body: {
        code: error.code,
        error: error.message,
        stage: error.stage,
      },
      status: error.status,
    };
  }

  return {
    body: {
      error: "Could not extract places from screenshots.",
      stage: "unknown" as const,
    },
    status: 500,
  };
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const directText = (payload as { output_text?: unknown }).output_text;

  if (typeof directText === "string") {
    return directText;
  }

  const output = (payload as { output?: unknown }).output;

  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        return [];
      }

      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }

          const text =
            (part as { text?: unknown }).text ??
            (part as { output_text?: unknown }).output_text;

          return typeof text === "string" ? text : "";
        })
        .filter(Boolean);
    })
    .join("\n");
}

function parseExtractionJson(text: string): OpenAIExtractionPayload {
  const trimmedText = text.trim();
  const jsonText =
    trimmedText.match(/```json\s*([\s\S]*?)```/)?.[1] ??
    trimmedText.match(/```\s*([\s\S]*?)```/)?.[1] ??
    trimmedText;

  try {
    return JSON.parse(jsonText) as OpenAIExtractionPayload;
  } catch (error) {
    console.error("[screenshot-intake/extract] OpenAI JSON parse failed", {
      message: error instanceof Error ? error.message : String(error),
      rawResponse: text,
    });

    throw new ScreenshotIntakeError(
      "OpenAI returned a response that could not be parsed as JSON.",
      { code: "openai_parse_failed", stage: "parse" },
    );
  }
}

async function extractPlacesFromImage(file: File, apiKey: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const imageUrl = `data:${file.type};base64,${bytes.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        {
          content: [
            {
              text: `Extract place candidates from this screenshot.

Return JSON only:
{
  "places": [
    {
      "rawName": "",
      "rawText": "",
      "cityHint": "",
      "countryHint": ""
    }
  ]
}

Rules:
- Extract only place, venue, cafe, restaurant, shop, hotel, sight, or bar names.
- Do not invent names.
- rawText should include supporting visible text.
- city/country only when visible or strongly implied.
- If no clear place is found, return an empty places array.`,
              type: "input_text",
            },
            {
              image_url: imageUrl,
              type: "input_image",
            },
          ],
          role: "user",
        },
      ],
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      text: {
        format: { type: "json_object" },
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    let openAiErrorCode: string | undefined;
    const responseText = await response.text();

    try {
      const errorPayload = JSON.parse(responseText) as {
        error?: { code?: string; message?: string; type?: string };
      };
      openAiErrorCode =
        errorPayload.error?.code ?? errorPayload.error?.type ?? undefined;
    } catch {
      openAiErrorCode = undefined;
    }

    console.error("[screenshot-intake/extract] OpenAI Vision API failed", {
      fileName: file.name,
      responseBody: responseText,
      status: response.status,
      type: file.type,
    });

    throw new ScreenshotIntakeError("OpenAI Vision extraction failed.", {
      code: openAiErrorCode ?? `openai_${response.status}`,
      stage: "openai",
      status: 502,
    });
  }

  const payload = await response.json();
  const text = extractOutputText(payload);
  const extraction = parseExtractionJson(text);

  return (extraction.places ?? [])
    .map((place) => ({
      cityHint: String(place.cityHint ?? "").trim(),
      countryHint: String(place.countryHint ?? "").trim(),
      fileName: file.name,
      rawName: String(place.rawName ?? "").trim(),
      rawText: String(place.rawText ?? "").trim(),
    }))
    .filter((place) => place.rawName);
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  console.info("[screenshot-intake/extract] environment check", {
    hasOpenAiApiKey: Boolean(apiKey),
    model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
  });

  if (!apiKey) {
    const error = new ScreenshotIntakeError("OPENAI_API_KEY is required.", {
      code: "missing_openai_api_key",
      stage: "validation",
      status: 500,
    });
    logScreenshotIntakeError(error, {
      route: "/api/admin/screenshot-intake/extract",
    });
    const sanitizedError = sanitizeError(error);

    return NextResponse.json(sanitizedError.body, {
      status: sanitizedError.status,
    });
  }

  try {
    const formData = await request.formData();
    const images = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File);

    if (images.length === 0) {
      throw new ScreenshotIntakeError(
        "At least one screenshot image is required.",
        {
          code: "no_images",
          stage: "validation",
          status: 400,
        },
      );
    }

    if (images.length > MAX_SCREENSHOT_FILES) {
      throw new ScreenshotIntakeError(
        `Upload at most ${MAX_SCREENSHOT_FILES} screenshots per run.`,
        {
          code: "too_many_images",
          stage: "validation",
          status: 400,
        },
      );
    }

    for (const image of images) {
      if (!ACCEPTED_SCREENSHOT_TYPES.has(image.type)) {
        throw new ScreenshotIntakeError(
          `Unsupported image type for ${image.name}: ${image.type}`,
          {
            code: "unsupported_image_type",
            stage: "validation",
            status: 400,
          },
        );
      }

      if (image.size > MAX_SCREENSHOT_BYTES) {
        throw new ScreenshotIntakeError(
          `${image.name} exceeds the 8 MB image limit.`,
          {
            code: "image_too_large",
            stage: "validation",
            status: 400,
          },
        );
      }
    }

    console.info("[screenshot-intake/extract] validated images", {
      count: images.length,
      files: images.map((image) => ({
        name: image.name,
        size: image.size,
        type: image.type,
      })),
    });

    const extractedRows = (
      await Promise.all(images.map((image) => extractPlacesFromImage(image, apiKey)))
    ).flat();

    return NextResponse.json({
      imagesProcessed: images.length,
      rows: extractedRows,
    });
  } catch (error) {
    logScreenshotIntakeError(error, {
      route: "/api/admin/screenshot-intake/extract",
    });
    const sanitizedError = sanitizeError(error);

    return NextResponse.json(sanitizedError.body, {
      status: sanitizedError.status,
    });
  }
}
