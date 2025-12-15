// services/historyService.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
// 匯入 ElderSummary 的類型定義 (假設您已經將 ElderSummary.tsx 中的類型 export 出來)
import { ElderSummary } from '@/components/ElderSummaryDisplay'; 

const STORAGE_KEY = '@health_records';

// 定義儲存紀錄的結構
export interface HealthRecord {
  id: string; // 唯一 ID (時間戳)
  date: string; // 格式化日期時間 (例如: 2025/12/14 16:41)
  timestamp: number; // Unix 時間戳，用於排序
  transcription: string;
  summary: ElderSummary;
}

/**
 * 取得所有儲存的看診紀錄，並依時間排序 (最新在前)。
 */
export async function getRecords(): Promise<HealthRecord[]> {
  try {
    const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
    if (jsonValue != null) {
      const records: HealthRecord[] = JSON.parse(jsonValue);
      // 依時間戳降序排列 (新的在前)
      return records.sort((a, b) => b.timestamp - a.timestamp);
    }
    return [];
  } catch (e) {
    console.error("Failed to read records from AsyncStorage", e);
    return [];
  }
}

/**
 * 儲存一筆新的看診紀錄到本地儲存。
 */
export async function saveRecord(transcription: string, summary: ElderSummary): Promise<void> {
  try {
    const now = new Date();
    const newRecord: HealthRecord = {
      id: now.getTime().toString(),
      // 使用本地格式化時間 (可選 'zh-TW')
      date: now.toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 
      timestamp: now.getTime(),
      transcription: transcription,
      summary: summary,
    };

    const existingRecords = await getRecords();
    existingRecords.push(newRecord);

    const jsonValue = JSON.stringify(existingRecords);
    await AsyncStorage.setItem(STORAGE_KEY, jsonValue);
    console.log("Record saved successfully:", newRecord.date);
  } catch (e) {
    console.error("Failed to save record to AsyncStorage", e);
  }
}

/**
 * 根據 ID 取得單筆看診紀錄。
 */
export async function getRecordById(id: string): Promise<HealthRecord | undefined> {
  const records = await getRecords();
  return records.find(r => r.id === id);
}


//根據 ID 刪除一筆看診紀錄。

export async function deleteRecord(id: string): Promise<void> {
  try {
    const existingRecords = await getRecords();
    
    // 篩選掉 ID 相符的紀錄，保留其餘的
    const updatedRecords = existingRecords.filter(r => r.id !== id);

    // 將更新後的紀錄列表寫回 AsyncStorage
    const jsonValue = JSON.stringify(updatedRecords);
    await AsyncStorage.setItem(STORAGE_KEY, jsonValue);
    console.log(`Record with ID ${id} deleted successfully.`);
  } catch (e) {
    console.error("Failed to delete record from AsyncStorage", e);
    // 即使刪除失敗，也不拋出錯誤，讓應用程式繼續運行
  }
}