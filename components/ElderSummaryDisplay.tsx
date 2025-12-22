import * as Speech from 'expo-speech';
import React, { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

// LLM 摘要的類型定義
export type ElderSummary = {
  diagnosis: { condition: string | null; reason: string | null };
  prohibitions: string[];
  danger_signs: string[];
  diet_advice: { good_to_eat: string[]; avoid_eating: string[] };
  follow_up: { date_time: string | null; day_of_week: string | null; tasks: string[] };
  audio_summary: string | null;
};

// 輔助函式：渲染列表
function renderList(items: string[] | undefined | null, emptyText: string) {
  const list = Array.isArray(items) ? items.filter((x) => typeof x === "string" && x.trim()) : [];
  if (list.length === 0) return <Text style={styles.empty}>{emptyText}</Text>;
  return (
    <View style={styles.list}>
      {list.map((t, idx) => (
        <Text key={`${idx}-${t}`} style={styles.item}>
          • {t}
        </Text>
      ))}
    </View>
  );
}

// ==========================================================
// 新增元件：SummaryBlock (實現分段顯示的核心)
// ==========================================================
interface SummaryBlockProps {
    title: string;
    children: React.ReactNode;
    // 為未來的 TTS 準備：每個區塊可以單獨朗讀的文字內容
    textToRead?: string | null; 
}

const SummaryBlock: React.FC<SummaryBlockProps> = ({ title, children, textToRead }) => {
    const [isReading, setIsReading] = useState(false);

const handleReadAloud = async () => {
        const text = textToRead?.trim();
        if (!text) {
            alert(`無 ${title} 內容可供朗讀。`);
            return;
        }

        if (isReading) {
            // 情況 1: 已經在朗讀 -> 停止朗讀
            Speech.stop();
            // 在這裡手動將狀態設為 false
            setIsReading(false); 
        } else {
            // 情況 2: 未朗讀 -> 開始朗讀
            setIsReading(true);
            
            // 移除 onStop 屬性
            Speech.speak(text, {
                language: 'en-US', 
                rate: 0.9,
                onDone: () => setIsReading(false), // 播放結束時設定狀態
                // onStop 屬性已被移除
                onError: (e) => {
                    console.error("TTS Error:", e);
                    setIsReading(false);
                },
            });
        }
    };

    return (
        <View style={styles.blockContainer}>
            <View style={styles.blockHeader}>
                <Text style={styles.blockTitle}>{title}</Text>
                {/* 獨立的朗讀按鈕 (只在有內容時顯示) */}
                {!!textToRead?.trim() && (
                    <Button
                        title={isReading ? "⏹️ 停止" : "🔊 朗讀"}
                        onPress={handleReadAloud}
                        color={isReading ? "#cc0000" : "#007AFF"}
                    />
                )}
            </View>
            <View style={styles.blockContent}>
                {children}
            </View>
        </View>
    );
}
// ==========================================================

const ElderSummaryDisplay: React.FC<{ summary: ElderSummary }> = ({ summary }) => {
    
    const diagnosisTextToRead = [
        summary?.diagnosis?.condition?.trim(),
        summary?.diagnosis?.reason?.trim() ? `Possible Cause: ${summary.diagnosis.reason}` : null,
    ].filter(Boolean).join('. '); // 使用句號分隔條件和原因

    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Key Summary for Seniors</Text>
            
            {/* 1. 診斷結果 (Diagnosis) */}
            <SummaryBlock 
                title="1. What the Doctor Said (診斷結果)" 
                textToRead={diagnosisTextToRead} // <-- 使用新的 diagnosisTextToRead
            >
                <Text style={styles.text}>
                    {summary?.diagnosis?.condition?.trim() ? summary.diagnosis.condition : "The doctor did not specify a condition today."}
                </Text>
                {!!summary?.diagnosis?.reason?.trim() && (
                    <Text style={styles.subText}>Possible Cause: {summary.diagnosis.reason}</Text>
                )}
            </SummaryBlock>

            {/* 2. 禁止事項 (Prohibitions) */}
            <SummaryBlock 
                title="2. Important Prohibitions (重要禁止事項)" 
                textToRead={summary?.prohibitions?.join('.\n') || null}
            >
                {renderList(summary?.prohibitions, "The doctor did not mention any specific prohibitions today.")}
            </SummaryBlock>

            {/* 3. 危險訊號 (Danger Signs) */}
            <SummaryBlock 
                title="3. Warning Signs (危險訊號)" 
                textToRead={summary?.danger_signs?.join('.\n') || null}
            >
                {renderList(summary?.danger_signs, "The doctor did not mention any emergency warning signs today.")}
            </SummaryBlock>

            {/* 4. 飲食建議 (Dietary Advice) */}
            <SummaryBlock 
                title="4. Dietary Recommendations (飲食建議)" 
                textToRead={`Recommended: ${summary?.diet_advice?.good_to_eat?.join(', ')}. Avoid: ${summary?.diet_advice?.avoid_eating?.join(', ')}`}
            >
                <Text style={styles.subTitle}>Recommended Foods</Text>
                {renderList(summary?.diet_advice?.good_to_eat, "The doctor did not mention any recommended foods today.")}

                <Text style={[styles.subTitle, { marginTop: 8 }]}>Foods to Avoid</Text>
                {renderList(summary?.diet_advice?.avoid_eating, "The doctor did not mention any foods to avoid today.")}
            </SummaryBlock>

            {/* 5. 回診提醒 (Follow-up) */}
            <SummaryBlock 
                title="5. Follow-up Reminder (回診提醒)"
                textToRead={`Follow up on ${summary?.follow_up?.date_time}. Tasks: ${summary?.follow_up?.tasks?.join(', ')}`}
            >
                <Text style={styles.text}>
                    {summary?.follow_up?.date_time?.trim()
                        ? `${summary.follow_up.date_time} (${summary.follow_up.day_of_week || "Day not provided"})`
                        : "The doctor did not specify a follow-up appointment time today."}
                </Text>
                <Text style={styles.subTitle}>Tasks Before Follow-up</Text>
                {renderList(summary?.follow_up?.tasks, "The doctor did not mention any preparation tasks today.")}
            </SummaryBlock>

            {/* 6. 語音播報腳本 (Audio Summary) */}
            <SummaryBlock 
                title="6. Voice Broadcast Script (長輩語音腳本)"
                textToRead={summary?.audio_summary}
            >
                <Text style={styles.text}>
                    {summary?.audio_summary?.trim() ? summary.audio_summary : "The doctor did not provide enough information for an audio summary today."}
                </Text>
            </SummaryBlock>
        </View>
    );
};

export default ElderSummaryDisplay;

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: 'center',
  },
  
  // 新增的區塊樣式
  blockContainer: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f9fafb", // 讓區塊視覺上更獨立
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6', // 藍色邊條強調區塊
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 2,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  blockTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1f2937",
    flexShrink: 1,
    paddingRight: 10,
  },
  blockContent: {
    paddingLeft: 4,
  },
  
  subTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    color: "#111827",
  },
  subText: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 21,
    color: "#374151",
  },
  list: {
    gap: 6,
    marginTop: 4,
  },
  item: {
    fontSize: 16,
    lineHeight: 22,
    color: "#111827",
  },
  empty: {
    fontSize: 15,
    lineHeight: 21,
    color: "#6b7280",
    fontStyle: "italic",
  },
});