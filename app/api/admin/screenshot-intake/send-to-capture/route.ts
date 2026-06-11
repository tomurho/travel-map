import { NextRequest, NextResponse } from "next/server";

import { appendScreenshotRowsToCapture } from "@/lib/place-sheet-pipeline";

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("x-admin-password") === adminPassword;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const input = (await request.json()) as {
    rows?: Array<{
      cityHint?: string;
      countryHint?: string;
      ignored?: boolean;
      rawName?: string;
      rawText?: string;
      sourceScreenshot?: string;
    }>;
    sheetId?: string;
  };
  const rows = (input.rows ?? [])
    .filter((row) => !row.ignored)
    .map((row) => ({
      cityHint: row.cityHint ?? "",
      countryHint: row.countryHint ?? "",
      rawName: row.rawName ?? "",
      rawText: row.rawText ?? "",
      sourceScreenshot: row.sourceScreenshot ?? "",
    }));

  try {
    const result = await appendScreenshotRowsToCapture({
      rows,
      sheetId: input.sheetId ?? "",
    });

    return NextResponse.json({
      rowsSubmitted: rows.length,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not send screenshot rows to Capture.",
      },
      { status: 500 },
    );
  }
}
