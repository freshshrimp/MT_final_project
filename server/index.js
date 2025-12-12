import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

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
  // eslint-disable-next-line no-console
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /stt
 * body:
 *  - audioBase64: string (m4a/aac base64，不要帶 data:... 前綴)
 *  - languageCode?: string (default zh-TW)
 */
app.post("/stt", async (req, res) => {
  const { audioBase64, languageCode = "zh-TW" } = req.body ?? {};

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
      },
      audio: {
        content: flacBase64,
      },
    };

    const apiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`;
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const result = await resp.json();
    if (!resp.ok) {
      res.status(resp.status).json(result);
      return;
    }

    const transcription =
      result?.results?.map((r) => r?.alternatives?.[0]?.transcript).filter(Boolean).join("\n") || "";

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
  // eslint-disable-next-line no-console
  console.log(`[stt-server] listening on http://0.0.0.0:${PORT}`);
});



