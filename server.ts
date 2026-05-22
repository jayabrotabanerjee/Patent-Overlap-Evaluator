import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.use(express.json({ limit: "10mb" }));

let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is required. Add it to your local .env or deployment secrets."
      );
    }

    aiClient = new GoogleGenAI({ apiKey });
  }

  return aiClient;
}

type AnalyzeBody = {
  claimId?: string;
  referenceId?: string;
  claimNumber?: string;
  referenceCitation?: string;
  claimText?: string;
  priorArtText?: string;
  referenceText?: string;
  productOrFeatureContext?: string;
  relevantSections?: string;
  cutoffDate?: string;
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    claimId: { type: Type.STRING },
    referenceId: { type: Type.STRING },
    overallScore: { type: Type.NUMBER },
    shortlistDecision: {
      type: Type.STRING,
      enum: ["SHORTLIST", "REVIEW", "REJECT"],
    },
    allCriticalElementsSupported: { type: Type.BOOLEAN },
    weakestElementId: { type: Type.STRING },
    noveltyRisk: {
      type: Type.STRING,
      enum: ["high", "medium", "low"],
    },
    implementationRelevance: {
      type: Type.STRING,
      enum: ["high", "medium", "low"],
    },
    claimChart: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          elementId: { type: Type.STRING },
          claimElement: { type: Type.STRING },
          normalizedRequirement: { type: Type.STRING },
          supportType: {
            type: Type.STRING,
            enum: [
              "direct",
              "implicit",
              "combination",
              "inferred",
              "missing",
              "contradicted",
            ],
          },
          score: { type: Type.NUMBER },
          evidence: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                quote: { type: Type.STRING },
                location: { type: Type.STRING },
                explanation: { type: Type.STRING },
              },
              required: ["quote", "explanation"],
            },
          },
          gap: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: [
          "elementId",
          "claimElement",
          "normalizedRequirement",
          "supportType",
          "score",
          "evidence",
          "gap",
          "confidence",
        ],
      },
    },
    keyReasons: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    missingLimitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    recommendedNextStep: {
      type: Type.STRING,
      enum: [
        "prepare_full_claim_chart",
        "run_secondary_reference_search",
        "review_by_human_analyst",
        "reject_from_shortlist",
      ],
    },
    analystSummary: { type: Type.STRING },
  },
  required: [
    "claimId",
    "referenceId",
    "overallScore",
    "shortlistDecision",
    "allCriticalElementsSupported",
    "weakestElementId",
    "noveltyRisk",
    "implementationRelevance",
    "claimChart",
    "keyReasons",
    "missingLimitations",
    "recommendedNextStep",
    "analystSummary",
  ],
};

function buildPatentPrompt(input: Required<Pick<AnalyzeBody, "claimText">> & AnalyzeBody) {
  const referenceId = input.referenceId || input.referenceCitation || "Prior Art Reference";
  const priorArtText = input.priorArtText || input.referenceText || "";

  return `
You are a senior patent analyst. Analyze the target claim against the prior-art reference for element-by-element overlap and shortlisting.

Core rules:
1. Break the claim into meaningful limitations.
2. Do not assume overlap merely because words are similar.
3. Every supported limitation must cite exact evidence from the prior art.
4. Mark supportType as:
   - direct: explicit disclosure
   - implicit: necessarily or clearly implied
   - combination: multiple disclosed teachings in the same reference are needed
   - inferred: analyst reasoning is needed beyond explicit text
   - missing: no real support
   - contradicted: the reference teaches away or conflicts
5. Score each element conservatively:
   - 0 = missing or contradicted
   - 1 = weak / speculative / broad thematic overlap
   - 2 = partial or implicit support
   - 3 = clear direct support
6. If any essential limitation is missing, do not SHORTLIST unless the missing issue is minor and explainable.
7. Prefer false-negative screening over false-positive shortlisting.
8. This is analytical screening, not a legal opinion.

Shortlisting logic:
- SHORTLIST: strong evidence across all or nearly all critical limitations.
- REVIEW: promising but has inferential, partial, or ambiguous support.
- REJECT: one or more important limitations are missing or only thematically related.

Claim ID: ${input.claimId || input.claimNumber || "Claim 1"}
Reference ID: ${referenceId}
${input.cutoffDate ? `Prior-art cutoff date: ${input.cutoffDate}` : ""}
${input.productOrFeatureContext || input.relevantSections ? `Product / feature / section context:\n${input.productOrFeatureContext || input.relevantSections}` : ""}

TARGET CLAIM:
"""
${input.claimText}
"""

PRIOR ART REFERENCE:
"""
${priorArtText}
"""
`;
}

async function analyzeOverlap(body: AnalyzeBody) {
  const claimText = body.claimText?.trim();
  const priorArtText = (body.priorArtText || body.referenceText || "").trim();

  if (!claimText || !priorArtText) {
    const error = new Error("claimText and priorArtText/referenceText are required.");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPatentPrompt({ ...body, claimText, priorArtText }),
    config: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 8192,
      systemInstruction:
        "Return only valid JSON that matches the provided schema. Be conservative and evidence-driven.",
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const raw = response.text || "{}";
  return JSON.parse(raw);
}

function toLegacyReport(result: any, body: AnalyzeBody) {
  const mapping = (result.claimChart || []).map((element: any, index: number) => {
    const evidence = Array.isArray(element.evidence) ? element.evidence : [];
    const disclosure = evidence.length
      ? evidence
          .map((item: any, itemIndex: number) => {
            const location = item.location ? ` (${item.location})` : "";
            return `${itemIndex + 1}. "${item.quote}"${location}\n${item.explanation}`;
          })
          .join("\n\n")
      : element.gap || "No supporting quote identified.";

    const finding =
      element.supportType === "direct"
        ? "Disclosed"
        : element.supportType === "implicit"
          ? "Inherently Disclosed"
          : element.supportType === "combination" || element.supportType === "inferred"
            ? "Partially Disclosed"
            : "Not Found";

    return {
      limitationId: element.elementId || `element_${index + 1}`,
      limitation: element.claimElement || element.normalizedRequirement || "Unparsed limitation",
      disclosure,
      finding,
    };
  });

  return {
    claimNumber: result.claimId || body.claimNumber || body.claimId || "Claim 1",
    referenceCitation:
      result.referenceId || body.referenceCitation || body.referenceId || "Prior Art Reference",
    mapping,
    strengthJudgment: {
      conclusion: `${result.shortlistDecision || "REVIEW"} - Overall Score ${result.overallScore ?? 0}/100`,
      rationale: result.analystSummary || "No analyst summary returned.",
      strategicRecommendation: [
        `Recommended next step: ${result.recommendedNextStep || "review_by_human_analyst"}`,
        result.keyReasons?.length ? `Key reasons: ${result.keyReasons.join("; ")}` : "",
        result.missingLimitations?.length
          ? `Missing limitations: ${result.missingLimitations.join("; ")}`
          : "No missing limitations identified.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };
}

app.post("/api/analyze-overlap", async (req, res) => {
  try {
    const result = await analyzeOverlap(req.body);
    return res.json(result);
  } catch (err: any) {
    console.error("/api/analyze-overlap failed:", err);
    return res.status(err.status || 500).json({
      error: "Analysis Failed",
      message: err.message || "An unexpected error occurred during claim evaluation.",
    });
  }
});

// Backward-compatible endpoint for older frontend code.
app.post("/api/evaluate", async (req, res) => {
  try {
    const result = await analyzeOverlap({
      ...req.body,
      claimId: req.body.claimNumber,
      referenceId: req.body.referenceCitation,
      priorArtText: req.body.referenceText,
      productOrFeatureContext: req.body.relevantSections,
    });

    return res.json(toLegacyReport(result, req.body));
  } catch (err: any) {
    console.error("/api/evaluate failed:", err);
    return res.status(err.status || 500).json({
      error: "Analysis Failed",
      message: err.message || "An unexpected error occurred during claim evaluation.",
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
