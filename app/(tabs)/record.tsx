import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router'; // 引入 useRouter
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { saveRecord } from '@/services/historyService'; 
import { ElderSummary } from '@/components/ElderSummaryDisplay';

//自訂的component
import AudioRecorder from '@/components/AudioRecorder';
// 移除結果顯示元件的引入，因為它們被移到新頁面
// import ElderSummaryDisplay, { type ElderSummary } from "@/components/ElderSummaryDisplay";
// import ResultDisplay from '@/components/ResultDisplay';

export default function RecordScreen() {
  // 移除所有結果相關的狀態，只保留 loading
  // const [analysisText, setAnalysisText] = useState("");
  // const [summary, setSummary] = useState<ElderSummary | null>(null);
  const [loading, setLoading] = useState(false);
  
  const router = useRouter(); // <-- 初始化 router

  // ✅ 注意：Google STT v1 不支援 AAC/m4a（Expo HIGH_QUALITY 預設就是 m4a/AAC）
  // 因此改走本機/自架的 STT server：前端只上傳 base64，後端負責 ffmpeg 轉 FLAC + 呼叫 Google STT
  // 在 `.env` 設定：EXPO_PUBLIC_STT_SERVER_URL=http://你的IP:3001/stt
  const STT_SERVER_URL = process.env.EXPO_PUBLIC_STT_SERVER_URL || "http://localhost:3001/stt";

  const getSummaryUrl = () => {
    if (STT_SERVER_URL.endsWith("/stt")) return STT_SERVER_URL.replace(/\/stt$/, "/summary");
    return `${STT_SERVER_URL.replace(/\/$/, "")}/summary`;
  };

  // 上傳錄音檔給 Google STT API
  const uploadAudioToServer = async (uri: string) => {
    setLoading(true);

    let transcription = "正在處理中...";
    // 用於儲存解析後的 ElderSummary 物件 
    let finalSummary: ElderSummary | null = null; 
    // 保持這個變數用於導航 (JSON 字串) 
    let finalSummaryJson: string | null = null;

    try {
      // 1. 將本地錄音檔 (URI) 讀取為 Base64 字串
      const audioContentBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const requestBody = {
        audioBase64: audioContentBase64,
        languageCode: "en-US",
      };

      // 3. 發送 POST 請求到 STT server
      const response = await fetch(STT_SERVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (response.ok) {
        transcription = result?.transcription || "";
        if (transcription) {

          // 4) 轉錄成功後，呼叫 /summary 讓 Gemini 摘要成長輩友善 JSON
          const summaryResp = await fetch(getSummaryUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcription,
              elderTitle: "Grandpa/Grandma",
            }),
          });
          const summaryResult = await summaryResp.json();
          if (summaryResp.ok) {
            // VVV [修改/新增]：解析物件，儲存紀錄 VVV
            finalSummary = summaryResult?.summary ?? null;

            if (finalSummary) {
              await saveRecord(transcription, finalSummary);
              // 儲存成功後，將物件轉為 JSON 字串用於導航
              finalSummaryJson = JSON.stringify(finalSummary); 
            } else {
              finalSummaryJson = null;
            }
  
          } else {
            console.error("Summary Server Error:", summaryResult);
            transcription += `\n\n❌ Summary failed: ${summaryResult?.error || "Unknown error"}`;
          }
        } else {
          transcription = "⚠️ Transcription completed, but no text was recognized (audio may be too quiet or empty).";
        }
      } else {
        console.error("STT Server Error:", result);


        const errorMessage = result.error?.message || result.error || "Unknown error";
        const errorStatus = result.error?.status;

        let errorText;
        if (errorStatus === "AUDIO_TOO_LARGE" || errorMessage.includes("exceeds duration limit")) {
          errorText = `❌ Audio file is too large or too long\n\nPlease record shorter audio (recommended under 60 seconds)`;
        } else if (errorMessage.includes("INVALID_ARGUMENT")) {
          errorText = `❌ Invalid audio format or corrupted file\n\n${errorMessage}`;
        } else {
          errorText = `❌ Transcription failed: ${errorMessage}`;
        }
        transcription = errorText; // 將錯誤訊息作為轉錄內容傳遞
      }

    } catch (err) {
      console.error("處理錄音失敗:", err);
      transcription = "❌ System error: Unable to read audio file or network connection issue.";
    } finally {
      setLoading(false);
      
      // 導航到新的分析頁面，並傳遞結果 
      router.push({
          pathname: "/(tabs)/analysis",
          params: { 
              transcription: transcription,
              summaryJson: finalSummaryJson,
          }
      });
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
      <Text style={styles.title}>Speech to Text (Google STT)</Text>

      {/* 錄音元件 */}
      <AudioRecorder onRecordingFinished={uploadAudioToServer} />

      {/* 載入狀態 */}
      {loading && <Text style={styles.loading}>Uploading and analyzing audio...</Text>}

      {/* 移除結果顯示元件 */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 70,
    paddingBottom: 40, // 增加底部留白，避免滑到底時被手機邊緣切到
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  loading: {
    marginTop: 10,
    fontStyle: "italic",
    textAlign: "center",
    color: "#666",
  },
});