import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { writesEnabled } from "@/lib/write-gate";

// GET /api/rulesets - Fetch all rulesets
export async function GET() {
  try {
    const rulesets = await prisma.generatedRuleset.findMany({
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(rulesets);
  } catch {
    console.error("Failed to fetch rulesets");
    return NextResponse.json({ error: "Failed to fetch rulesets" }, { status: 500 });
  }
}

// POST /api/rulesets - Update a ruleset
export async function POST(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }

    const ruleset = await prisma.generatedRuleset.update({
      where: { id },
      data: {
        matchingStrategy: data.matchingStrategy,
        filters: data.filters,
        episodeRegex: data.episodeRegex,
        seasonRegex: data.seasonRegex,
        titleRegexRules: data.titleRegexRules,
      },
    });

    return NextResponse.json(ruleset);
  } catch {
    console.error("Failed to update ruleset");
    return NextResponse.json({ error: "Failed to update ruleset" }, { status: 500 });
  }
}

// DELETE /api/rulesets - Delete a ruleset
export async function DELETE(request: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Maintenance: writes disabled" }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID parameter required" }, { status: 400 });
  }

  try {
    await prisma.generatedRuleset.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch {
    console.error("Failed to delete ruleset");
    return NextResponse.json({ error: "Failed to delete ruleset" }, { status: 500 });
  }
}
