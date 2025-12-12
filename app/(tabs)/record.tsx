import * as FileSystem from 'expo-file-system/legacy'; // SDK 54 起：legacy methods 需從 /legacy 匯入
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

//自訂的component
import AudioRecorder from '@/components/AudioRecorder';
import ResultDisplay from '@/components/ResultDisplay';

export default function RecordScreen() {
  const [analysisText, setAnalysisText] = useState("");
  const [loading, setLoading] = useState(false);

  // ✅ 注意：Google STT v1 不支援 AAC/m4a（Expo HIGH_QUALITY 預設就是 m4a/AAC）
  // 因此改走本機/自架的 STT server：前端只上傳 base64，後端負責 ffmpeg 轉 FLAC + 呼叫 Google STT
  // 在 `.env` 設定：EXPO_PUBLIC_STT_SERVER_URL=http://你的IP:3001/stt
  const STT_SERVER_URL = process.env.EXPO_PUBLIC_STT_SERVER_URL || "http://localhost:3001/stt";

  // 上傳錄音檔給 Google STT API
  const uploadAudioToServer = async (uri: string) => {
    setLoading(true);
    setAnalysisText(""); // 清空上次結果

    try {
      // 1. 將本地錄音檔 (URI) 讀取為 Base64 字串
      // 送到 STT server，由 server 做轉檔與呼叫 Google STT
      const audioContentBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const requestBody = {
        audioBase64: audioContentBase64,
        languageCode: "zh-TW",
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
        const transcription = result?.transcription || "";
        if (transcription) setAnalysisText(`✅ 轉錄成功：\n\n${transcription}`);
        else setAnalysisText("⚠️ 轉錄完成，但沒有辨識出任何文字 (可能是聲音太小或空白)。");
      } else {
        console.error("STT Server Error:", result);
        setAnalysisText(`❌ 轉錄失敗: ${result.error?.message || result.error || "未知錯誤"}`);
      }

    } catch (err) {
      console.error("處理錄音失敗:", err);
      setAnalysisText("❌ 系統錯誤：無法讀取錄音檔或網路連線異常。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎤 語音轉文字 (Google STT)</Text>

      {/* 錄音元件 */}
      <AudioRecorder onRecordingFinished={uploadAudioToServer} />

      {/* 載入狀態 */}
      {loading && <Text style={styles.loading}>正在上傳並分析音訊中...</Text>}

      {/* 結果顯示 */}
      {analysisText !== "" && <ResultDisplay text={analysisText} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 70,
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