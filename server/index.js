import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_API_KEY || "";
if (!GOOGLE_API_KEY) {
  console.warn(
    "[stt-server] 找不到 GOOGLE_API_KEY / EXPO_PUBLIC_GOOGLE_API_KEY。請在專案根目錄 `.env` 設定其中之一。"
  );
}

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";
if (!GEMINI_API_KEY) {
  console.warn("[stt-server] 找不到 GEMINI_API_KEY（可先沿用 GOOGLE_API_KEY），/summary 將無法使用。");
}

function formatDateInTaipei(date = new Date()) {
  // YYYY-MM-DD (Asia/Taipei)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("找不到 ffmpeg（ffmpeg-static 回傳空值）"));
      return;
    }
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 轉檔失敗 (code=${code})\n${stderr}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function googleSpeechRecognize({ apiKey, requestBody }) {
  const recognizeUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`;
  const longRunningUrl = `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`;

  // 1) 先用同步（快、便宜）；若遇到「超過 1 分鐘」再自動降級為 LongRunningRecognize。
  const resp = await fetch(recognizeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const syncResult = await resp.json().catch(() => ({}));
  if (resp.ok) return syncResult;

  const msg = syncResult?.error?.message || "";
  const isTooLong =
    typeof msg === "string" &&
    (msg.includes("Sync input too long") ||
      msg.includes("For audio longer than 1 min use LongRunningRecognize"));

  if (!isTooLong) {
    const err = new Error(msg || "Google STT 同步辨識失敗");
    err.status = resp.status;
    err.payload = syncResult;
    throw err;
  }

  // 2) LongRunningRecognize：回傳 operation，需要輪詢 operations.get 直到 done。
  const lrResp = await fetch(longRunningUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const op = await lrResp.json().catch(() => ({}));
  if (!lrResp.ok) {
    const err = new Error(op?.error?.message || "Google STT 長音檔辨識啟動失敗");
    err.status = lrResp.status;
    err.payload = op;
    throw err;
  }

  const opName = op?.name;
  if (!opName) {
    const err = new Error("Google STT 長音檔辨識未回傳 operation name");
    err.status = 502;
    err.payload = op;
    throw err;
  }

  const opUrl = `https://speech.googleapis.com/v1/operations/${encodeURIComponent(opName)}?key=${apiKey}`;
  const timeoutMs = Number(process.env.STT_LONGRUN_TIMEOUT_MS || 180000); // default 3 min
  const start = Date.now();

  // 輪詢：前幾次快一點，後面放慢，避免打太兇
  const backoffs = [500, 1000, 1500, 2000, 2500, 3000];
  let i = 0;

  while (true) {
    if (Date.now() - start > timeoutMs) {
      const err = new Error("Google STT 長音檔辨識逾時（operation 尚未完成）");
      err.status = 504;
      err.payload = { operation: opName };
      throw err;
    }

    const pollResp = await fetch(opUrl, { method: "GET" });
    const poll = await pollResp.json().catch(() => ({}));

    if (!pollResp.ok) {
      const err = new Error(poll?.error?.message || "Google STT operation 輪詢失敗");
      err.status = pollResp.status;
      err.payload = poll;
      throw err;
    }

    if (poll?.done) {
      if (poll?.error) {
        const err = new Error(poll?.error?.message || "Google STT 長音檔辨識失敗");
        err.status = 502;
        err.payload = poll;
        throw err;
      }
      return poll?.response || {};
    }

    await sleep(backoffs[Math.min(i, backoffs.length - 1)]);
    i += 1;
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /summary
 * body:
 *  - transcription: string (STT 文字全文)
 *  - elderTitle?: string (長輩稱呼，影響 audio_summary 開頭)
 */
app.post("/summary", async (req, res) => {
  const { transcription, elderTitle = "阿公/阿嬤" } = req.body ?? {};

  if (!transcription || typeof transcription !== "string") {
    res.status(400).json({ error: "缺少 transcription（字串）" });
    return;
  }
  if (!GEMINI_API_KEY) {
    res.status(500).json({ error: "伺服器未設定 GEMINI_API_KEY（可沿用 GOOGLE_API_KEY）" });
    return;
  }
  if (!GEMINI_MODEL || typeof GEMINI_MODEL !== "string") {
    res.status(500).json({ error: "伺服器未設定 GEMINI_MODEL" });
    return;
  }

  const currentDate = formatDateInTaipei(new Date());

  const prompt = `
  # Role
You are a caring, professional, and extremely patient "Personal Health Manager" for the elderly. Your task is to read the "Doctor-Patient Conversation Transcript" and organize it into a JSON format for an App display.

# Constraints
1. **Language Style**: The output content MUST be in **English**. Use very simple, plain, and warm language (imagine speaking to a 70-year-old elder). Avoid complex medical jargon in the explanations.
2. **Absolute Honesty**: Extract information ONLY based on the conversation content. If the doctor didn't mention a specific item, leave the field blank or set it to \`null\`. Do NOT fabricate medical advice.
3. **Date Handling**: Calculate the follow-up date based on the current date: ${currentDate}.

# Extraction Rules (Please extract and translate for the following fields)

1. **diagnosis (What did the doctor say?)**
   - **Goal**: Extract both the "Professional Disease Name" and a "Layman's Explanation".
   - **name (Formal Name)**:
     - Directly extract the medical term mentioned by the doctor (e.g., Hypertension, Acute Gastroenteritis, Osteoarthritis).
     - If the doctor only described symptoms without a name, summarize a standard disease name based on context.
   - **explanation (Layman's Explanation)**:
     - Explain the disease name in the simplest, easiest-to-understand way.
     - Format example: "Simply put...", "It means...".
   - **reason (Cause)**:
     - Extract the cause of the illness mentioned by the doctor.

   - **Example**:
     - *Doctor's words*: "This looks like typical Herpes Zoster."
     - *Extraction Result*:
       - name: "Shingles"
       - explanation: "It is a painful skin rash caused by a virus, often happening when your immunity is low."

2. **prohibitions (Most important "DO NOTs")**
   - Extract all prohibitions (behaviors, drug interactions).
   - **Keyword Detection**: Don't, Stop, Forbidden, Avoid.
   - The tone should emphasize severity (e.g., "Absolutely do not...").

3. **danger_signs (Warning Signs)**
   - Extract conditions for going to the ER or returning to the clinic immediately.
   - Distinguish between "side effects" and "danger signs"; only list situations requiring immediate medical attention.

4. **diet_advice (Dietary Advice)**
   - Separate into "Recommended to eat (good_to_eat)" and "Avoid eating (avoid_eating)".

5. **follow_up (Follow-up Reminder)**
   - Extract the specific date and time for the next visit.
   - Extract any pre-visit tasks (e.g., fasting, blood test, bring prescription).

6. **audio_summary (Voice Broadcast Summary)**
   - This is a script to be read aloud to the elder.
   - **Format**: Start with "Hello ${elderTitle}, today the doctor said...".
   - **Content**: Summarize today's key points in the gentlest tone within 100 words (Condition + The most important instruction + Comfort/Encouragement).

# Output Format (JSON)
Please output strictly in JSON format, without Markdown markers or other text:

{
  "diagnosis": {
    "name": "Formal disease name spoken by the doctor",
    "explanation": "Simple explanation for the elder",
    "reason": "Cause of the illness"
  },
  "prohibitions": ["Prohibition 1", "Prohibition 2"],
  "danger_signs": ["Sign 1", "Sign 2"],
  "diet_advice": {
    "good_to_eat": ["Food 1", "Food 2"],
    "avoid_eating": ["Food 1", "Food 2"]
  },
  "follow_up": {
    "date_time": "YYYY-MM-DD HH:MM",
    "day_of_week": "Day of week",
    "tasks": ["Task 1", "Task 2"]
  },
  "audio_summary": "Warm voice script content in English..."
}

Below is the Doctor-Patient Conversation Transcript:
${transcription}`;

  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      diagnosis: {
        type: SchemaType.OBJECT,
        properties: {
          condition: { type: SchemaType.STRING, nullable: true },
          reason: { type: SchemaType.STRING, nullable: true },
        },
        required: ["condition", "reason"],
      },
      prohibitions: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
      danger_signs: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
      diet_advice: {
        type: SchemaType.OBJECT,
        properties: {
          good_to_eat: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          avoid_eating: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["good_to_eat", "avoid_eating"],
      },
      follow_up: {
        type: SchemaType.OBJECT,
        properties: {
          date_time: { type: SchemaType.STRING, nullable: true },
          day_of_week: { type: SchemaType.STRING, nullable: true },
          tasks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["date_time", "day_of_week", "tasks"],
      },
      audio_summary: { type: SchemaType.STRING, nullable: true },
    },
    required: ["diagnosis", "prohibitions", "danger_signs", "diet_advice", "follow_up", "audio_summary"],
  };

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() ?? "";

    let json;
    try {
      json = JSON.parse(text);
    } catch (_e) {
      res.status(502).json({
        error: "Gemini 回傳不是合法 JSON，請確認 GEMINI_MODEL/提示詞/回應設定",
        rawText: text?.slice?.(0, 2000) ?? String(text),
      });
      return;
    }

    res.json({
      current_date: currentDate,
      model: GEMINI_MODEL,
      summary: json,
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * Helper function to get audio duration using ffprobe
 */
async function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffprobePath?.path) {
      reject(new Error("找不到 ffprobe"));
      return;
    }

    // Use ffprobe (comes from ffprobe-static) to get duration
    const ffprobeArgs = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ];

    const child = spawn(ffprobePath.path, ffprobeArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim());
        resolve(duration);
      } else {
        reject(new Error(`ffprobe 失敗 (code=${code})\n${stderr}`));
      }
    });
  });
}

/**
 * Helper function to split audio into chunks
 */
async function splitAudioIntoChunks(inputPath, tmpDir, chunkDurationSeconds = 50) {
  const duration = await getAudioDuration(inputPath);

  if (duration <= 55) {
    // Audio is short enough, no need to split
    return [{ path: inputPath, start: 0, duration }];
  }

  const chunks = [];
  let currentTime = 0;
  let chunkIndex = 0;

  while (currentTime < duration) {
    const chunkPath = path.join(tmpDir, `chunk_${chunkIndex}.flac`);
    const chunkDuration = Math.min(chunkDurationSeconds, duration - currentTime);

    // Extract chunk using ffmpeg
    await runFfmpeg([
      "-y",
      "-i", inputPath,
      "-ss", currentTime.toString(),
      "-t", chunkDuration.toString(),
      "-ac", "1",
      "-ar", "16000",
      "-vn",
      chunkPath
    ]);

    chunks.push({
      path: chunkPath,
      start: currentTime,
      duration: chunkDuration,
      index: chunkIndex
    });

    currentTime += chunkDuration;
    chunkIndex++;
  }

  return chunks;
}

/**
 * POST /stt
 * body:
 *  - audioBase64: string (m4a/aac base64，不要帶 data:... 前綴)
 *  - languageCode?: string (default en-US)
 */
app.post("/stt", async (req, res) => {
  const { audioBase64, languageCode = "en-US" } = req.body ?? {};

  if (!audioBase64 || typeof audioBase64 !== "string") {
    res.status(400).json({ error: "缺少 audioBase64（字串）" });
    return;
  }
  if (!GOOGLE_API_KEY) {
    res.status(500).json({ error: "伺服器未設定 GOOGLE_API_KEY / EXPO_PUBLIC_GOOGLE_API_KEY" });
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stt-"));
  const inputPath = path.join(tmpDir, "input.m4a");

  try {
    const inputBuf = Buffer.from(audioBase64, "base64");
    await fs.writeFile(inputPath, inputBuf);

    // Get audio duration and split if necessary
    const chunks = await splitAudioIntoChunks(inputPath, tmpDir, 50);

    console.log(`[STT] Processing ${chunks.length} chunk(s) for audio`);

    // Process each chunk
    const chunkResults = [];

    for (const chunk of chunks) {
      const flacBuf = await fs.readFile(chunk.path);
      const flacBase64 = flacBuf.toString("base64");

      const requestBody = {
        config: {
          encoding: "FLAC",
          sampleRateHertz: 16000,
          languageCode,
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          diarizationConfig: {
            enableSpeakerDiarization: true,
            minSpeakerCount: 2,
            maxSpeakerCount: 2,
          },
          useEnhanced: true,
          model: "default"
        },
        audio: {
          content: flacBase64,
        },
      };

      let result;
      try {
        console.log(`[STT] Processing chunk ${chunk.index + 1}/${chunks.length}`);
        result = await googleSpeechRecognize({ apiKey: GOOGLE_API_KEY, requestBody });
        chunkResults.push({ chunk, result });
      } catch (err) {
        const status = err?.status || 500;
        const payload = err?.payload;
        if (payload && (payload.error || payload.errors)) {
          res.status(status).json(payload);
        } else {
          res.status(status).json({ error: { message: err?.message || String(err) } });
        }
        return;
      }
    }

    // Combine results from all chunks
    let transcription = "";
    const isZh = typeof languageCode === "string" && languageCode.toLowerCase().startsWith("zh");
    const joiner = isZh ? "" : " ";

    // Process each chunk's result
    for (let i = 0; i < chunkResults.length; i++) {
      const { result } = chunkResults[i];
      const results = Array.isArray(result?.results) ? result.results : [];
      let diarizedWords = [];

      // Find diarization results
      for (let idx = results.length - 1; idx >= 0; idx -= 1) {
        const w = results?.[idx]?.alternatives?.[0]?.words || [];
        const hasSpeakerTag = Array.isArray(w) && w.some((x) => Number.isFinite(x?.speakerTag));
        if (hasSpeakerTag) {
          diarizedWords = w;
          break;
        }
      }

      if (diarizedWords.length > 0) {
        let currentSpeaker = null;
        let started = i > 0; // If not first chunk, we've already started

        diarizedWords.forEach((wordInfo) => {
          const word = wordInfo?.word ?? "";
          if (!word) return;

          const speakerTag = Number.isFinite(wordInfo?.speakerTag) ? wordInfo.speakerTag : null;

          if (speakerTag === null) {
            transcription += word + joiner;
            return;
          }

          if (currentSpeaker !== speakerTag) {
            if (started) transcription += "\n\n";
            transcription += `[說話者 ${speakerTag}]: `;
            currentSpeaker = speakerTag;
            started = true;
          }

          transcription += word + joiner;
        });
      } else {
        // Fallback: no diarization
        const chunkText = results.map((r) => r?.alternatives?.[0]?.transcript).filter(Boolean).join("\n") || "";
        if (chunkText) {
          if (i > 0 && transcription) transcription += "\n";
          transcription += chunkText;
        }
      }
    }

    transcription = transcription.trimEnd();

    res.json({
      transcription,
      chunksProcessed: chunks.length,
      raw: chunkResults.map(cr => cr.result),
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  } finally {
    // 清理暫存資料夾
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const PORT = Number(process.env.STT_SERVER_PORT || 3001);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[stt-server] listening on http://0.0.0.0:${PORT}`);
});



