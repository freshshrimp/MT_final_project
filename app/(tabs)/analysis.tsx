import { useLocalSearchParams, Stack } from 'expo-router';
import React, { useState, useEffect } from 'react'; 
import { ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native'; 

import ElderSummaryDisplay, { type ElderSummary } from "@/components/ElderSummaryDisplay";
// 引入歷史服務
import { getRecordById } from '@/services/historyService'; 

/*分析結果顯示頁面*/
export default function AnalysisScreen() {
  const { transcription, summaryJson, recordId } = useLocalSearchParams<{ 
    transcription?: string, 
    summaryJson?: string, 
    recordId?: string 
  }>();

  const [summary, setSummary] = useState<ElderSummary | null>(null);
  const [analysisText, setAnalysisText] = useState("正在載入內容...");
  const [loading, setLoading] = useState(true);

  // 載入資料的函式
  const loadData = async () => {
    setLoading(true);
    
    // 情境 1: 從 History 頁面導航 (使用 ID 取得完整紀錄)
    if (recordId) {
      const record = await getRecordById(recordId);
      if (record) {
        setAnalysisText(record.transcription);
        setSummary(record.summary);
      } else {
        setAnalysisText("❌ 無法找到該筆看診紀錄。");
        setSummary(null);
      }
    } 
    // 情境 2: 從 Record 頁面導航 (直接傳遞資料)
    else if (summaryJson || transcription) {
      setAnalysisText(transcription || "無法取得轉錄文字。");
      let parsedSummary: ElderSummary | null = null;
      
      if (summaryJson) {
        try {
          const parsed = JSON.parse(summaryJson);
          if (parsed && typeof parsed === 'object') {
            parsedSummary = parsed as ElderSummary;
          }
        } catch (e) {
          console.error("解析 ElderSummary JSON 失敗:", e);
          setAnalysisText((prev) => prev + "\n\n❌ 錯誤：無法載入結構化摘要資料。");
        }
      }
      setSummary(parsedSummary);
    } 
    // 情境 3: 無資料
    else {
      setAnalysisText("❌ 無法載入分析資料。");
      setSummary(null);
    }

    setLoading(false);
  };

  // 監聽路由參數變化並載入資料
  useEffect(() => {
    loadData();
    // 依賴項只包含路由參數
  }, [recordId, summaryJson, transcription]); 

  // 根據來源決定導航欄標題
  const screenTitle = recordId ? '看診紀錄詳情' : 'Report';
  
  return (
    <>
      <Stack.Screen options={{ title: screenTitle }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.title}>🎙️ 語音分析報告</Text>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.loadingText}>載入中...</Text>
          </View>
        ) : summary ? (
          <ElderSummaryDisplay summary={summary} />
        ) : (
          <View style={styles.errorContainer}>
              <Text style={styles.errorText}>❌ 無法顯示結構化摘要。資料載入失敗或格式錯誤。</Text>
              <Text style={styles.errorTextDetail}>原始轉錄文字：{analysisText}</Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f8f8', 
  },
  scrollContent: {
    padding: 20,
    paddingTop: 50,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
    color: '#1f2937',
  },
  errorContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f87171',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorTextDetail: {
    color: '#b91c1c',
    fontSize: 14,
    marginTop: 5,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
    gap: 10,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  }
});