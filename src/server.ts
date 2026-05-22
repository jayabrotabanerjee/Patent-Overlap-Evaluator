import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-loaded Gemini client
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Evaluation endpoint
app.post("/api/evaluate", async (req, res) => {
  try {
    const { claimNumber, claimText, referenceCitation, referenceText, relevantSections } = req.body;

    if (!claimText || !referenceText) {
      return res.status(400).json({ error: "Missing required parameters: claimText and referenceText are required." });
    }

    let ai;
    try {
      ai = getGeminiClient();
    } catch (err: any) {
      return res.status(500).json({ 
        error: "Configuration Error", 
        message: err.message || "GEMINI_API_KEY is not defined. Please set it in the AI Studio Settings." 
      });
    }

    const prompt = `Please perform a detailed patent overlap evaluation between the following patent claim and the provided prior art reference.

TARGET PATENT CLAIM (${claimNumber || "1"}):
${claimText}

PRIOR ART REFERENCE (${referenceCitation}):
${referenceText}

${relevantSections ? `OPTIONAL RELEVANT SECTIONS HIGHLIGHTED BY USER:\n${relevantSections}` : ""}

Please parse the claim into logical, separate element limitations (e.g. 1a, 1b, 1c...).
For each limitation, identify the exact text/disclosure in the prior art that covers it. Be highly rigorous, strictly objective, and do not bridge gaps. If the prior art has no clear disclosure for a limitation, mark it as 'Not Found' and explicitly explain what is missing.
Provide a final, synthesized judgment detailing if it's anticipatory (§102), prime obviousness (§103), secondary obviousness (§103), or weak/irrelevant. Include next steps and strategic patent suggestions.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `You are a meticulous Senior Patent Analyst with exceptional attention to detail.
Your objective is to perform a rigorous, element-by-element comparison of a prior art reference against a specific patent claim and then synthesize the findings into a clear, conclusive judgment of the reference's strength.

Core Principles:
• Strict Objectivity: Your evaluation must be based solely on the text and figures within the provided prior art. Do not infer information or bridge gaps.
• Element-Level Precision: Your primary output will map each claim limitation.
• Conclusive Synthesis: End with an overall 'Strength of Reference' judgment summarizing findings and explaining why.
• Return a structured JSON response corresponding exactly to the schema.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            claimNumber: { 
              type: Type.STRING, 
              description: "The identifier of the claim evaluated, like '1' or 'Claim 1'" 
            },
            referenceCitation: { 
              type: Type.STRING, 
              description: "The title or citation of the prior art reference used" 
            },
            mapping: {
              type: Type.ARRAY,
              description: "List of mapped claim element limitations",
              items: {
                type: Type.OBJECT,
                properties: {
                  limitationId: { 
                    type: Type.STRING, 
                    description: "Alphabetical or numerical index of the limitation, e.g. '1a', '1b', '1c'" 
                  },
                  limitation: { 
                    type: Type.STRING, 
                    description: "The specific claim limitation parsed from the overall claim" 
                  },
                  disclosure: { 
                    type: Type.STRING, 
                    description: "The exact matching text or description of findings from the prior art reference, with citations (column, line numbers, or paragraph/page numbers if available). If not found, explain clearly." 
                  },
                  finding: { 
                    type: Type.STRING, 
                    enum: ["Disclosed", "Partially Disclosed", "Inherently Disclosed", "Not Found"],
                    description: "Evaluation result for this specific elements" 
                  }
                },
                required: ["limitationId", "limitation", "disclosure", "finding"]
              }
            },
            strengthJudgment: {
              type: Type.OBJECT,
              properties: {
                conclusion: { 
                  type: Type.STRING, 
                  description: "Final patent strength category, e.g., 'Highly Anticipatory (§102) Reference', 'Strong Obviousness (§103) Primary Reference', 'Secondary Obviousness (§103) Component', 'Weak / Irrelevant'" 
                },
                rationale: { 
                  type: Type.STRING, 
                  description: "Comprehensive analytical rationale explaining why this reference falls into this category based of found/missing elements." 
                },
                strategicRecommendation: { 
                  type: Type.STRING, 
                  description: "Strategic litigation, invalidity search, or prosecution recommendations based on this evaluation." 
                }
              },
              required: ["conclusion", "rationale", "strategicRecommendation"]
            }
          },
          required: ["claimNumber", "referenceCitation", "mapping", "strengthJudgment"]
        }
      }
    });

    const text = response.text || "{}";
    const reportData = JSON.parse(text);

    return res.json(reportData);
  } catch (err: any) {
    console.error("Evaluation error:", err);
    return res.status(500).json({ 
      error: "Analysis Failed", 
      message: err.message || "An unexpected error occurred during claim evaluation." 
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
