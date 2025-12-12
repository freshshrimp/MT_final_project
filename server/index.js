import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import ffmpegPath from "ffmpeg-static";

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
  const outputPath = path.join(tmpDir, "output.flac");

  try {
    const inputBuf = Buffer.from(audioBase64, "base64");
    await fs.writeFile(inputPath, inputBuf);

    // 轉成 Google STT v1 支援的 FLAC，並統一成 16kHz/mono（較省、也常見於語音）
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-vn",
      outputPath,
    ]);

    const flacBuf = await fs.readFile(outputPath);
    const flacBase64 = flacBuf.toString("base64");

    const requestBody = {
      config: {
        encoding: "FLAC",
        sampleRateHertz: 16000,
        languageCode,
        enableAutomaticPunctuation: true, // 自動加入標點符號
        // 為了讓 diarization 的 words 更穩定地出現在回應中（包含 speakerTag）
        enableWordTimeOffsets: true,

        //開啟說話者辨識 (區分醫生與病患)
        diarizationConfig: {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2, // 最少 2 人
          maxSpeakerCount: 2, // 最多 3 人 (依實際情況調整)
        },

        //使用增強模型 (通常對電話或錄音檔效果較好)
        useEnhanced: true,
        model: "default" 
      },
      audio: {
        content: flacBase64,
      },
    };

    let result;
    try {
      result = await googleSpeechRecognize({ apiKey: GOOGLE_API_KEY, requestBody });
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

    let transcription = "";
    
    // 中文不要硬塞空格，英文等語系才加空格
    const isZh = typeof languageCode === "string" && languageCode.toLowerCase().startsWith("zh");
    const joiner = isZh ? "" : " ";

    // 1) diarization：不要把所有 results 的 words 全展平（會混到沒有 speakerTag 的片段，導致 [說話者 undefined]）
    const results = Array.isArray(result?.results) ? result.results : [];
    let diarizedWords = [];

    // 從後往前找：通常 diarization 完整結果會出現在最後幾個 result
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
      let started = false;

      diarizedWords.forEach((wordInfo) => {
        const word = wordInfo?.word ?? "";
        if (!word) return;

        const speakerTag = Number.isFinite(wordInfo?.speakerTag) ? wordInfo.speakerTag : null;

        // 沒有 speakerTag：
        // - 若已經有 currentSpeaker，就視為同一段落繼續接（避免印出 undefined）
        // - 若還沒開始任何段落，就先忽略標籤、直接累積文字（不加 [說話者 ...]）
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

      transcription = transcription.trimEnd();
    } else {
      // 2) fallback：沒有 diarization words，就回到純 transcript 拼接
      transcription =
        results.map((r) => r?.alternatives?.[0]?.transcript).filter(Boolean).join("\n") || "";
    }

    res.json({
      transcription,
      raw: result,
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



