import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useState, useCallback } from 'react';
// VVV 引入 Alert 和 Button VVV
import { FlatList, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator, Alert, Button } from 'react-native'; 

// VVV 引入 deleteRecord VVV
import { getRecords, HealthRecord, deleteRecord } from '@/services/historyService';

// 定義列表顯示需要的類型
type HistoryListItem = Pick<HealthRecord, 'id' | 'date' | 'transcription'>;

export default function HistoryScreen() {
  const [records, setRecords] = useState<HistoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const loadRecords = async () => {
    setLoading(true);
    const storedRecords = await getRecords();
    // 映射為列表顯示需要的簡化資料
    const listItems = storedRecords.map(r => ({
        id: r.id,
        date: r.date,
        transcription: r.transcription,
    }));
    setRecords(listItems);
    setLoading(false);
  };

  // 當頁面被選中或再次獲得焦點時，重新載入紀錄
  useFocusEffect(
    useCallback(() => {
      loadRecords();
    }, [])
  );
  
  // VVV 新增刪除處理函式 VVV
  const handleDeleteRecord = (id: string, date: string) => {
    Alert.alert(
      "確認刪除紀錄",
      `您確定要刪除 ${date} 的看診紀錄嗎？此操作不可逆。`,
      [
        {
          text: "取消",
          style: "cancel"
        },
        {
          text: "確認刪除",
          style: "destructive",
          onPress: async () => {
            await deleteRecord(id);
            // 刪除後刷新列表
            loadRecords(); 
          }
        }
      ]
    );
  };
  // ^^^ 新增刪除處理函式 ^^^


  const handlePressRecord = (record: HistoryListItem) => {
    // 導航到 analysis 頁面，並傳遞 recordId
    router.push({
      pathname: '/(tabs)/analysis',
      params: {
        recordId: record.id,
      },
    });
  };

  const renderItem = ({ item }: { item: HistoryListItem }) => (
    <View style={styles.recordItemContainer}>
      {/* 點擊主體區域進入詳情 */}
      <TouchableOpacity style={styles.recordItem} onPress={() => handlePressRecord(item)}>
        <Text style={styles.recordDate}>{item.date}</Text>
        {/* 顯示轉錄內容的第一行或前 50 字作為預覽 */}
        <Text style={styles.recordPreview} numberOfLines={1}>
          {item.transcription.split('\n')[0]?.substring(0, 50).trim() || '無轉錄內容'}...
        </Text>
        <Text style={styles.recordArrow}>&gt;</Text>
      </TouchableOpacity>
      
      {/* VVV 刪除按鈕 VVV */}
      <View style={styles.deleteButtonWrapper}>
        <Button 
          title="刪除" 
          onPress={() => handleDeleteRecord(item.id, item.date)} 
          color="#cc0000"
        />
      </View>
      {/* ^^^ 刪除按鈕 ^^^ */}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: '看診紀錄' }} />
      <View style={styles.container}>
        <Text style={styles.title}>📅 歷史看診紀錄</Text>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#3b82f6" />
            <Text style={styles.message}>載入中...</Text>
          </View>
        ) : records.length === 0 ? (
          <Text style={styles.message}>目前沒有任何看診紀錄。開始錄音以創建您的第一筆紀錄。</Text>
        ) : (
          <FlatList
            data={records}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f8f8f8',
  },
  listContent: {
    paddingBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
    color: '#1f2937',
  },
  // VVV [新增] 包裹容器 VVV
  recordItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderLeftWidth: 5,
    borderLeftColor: '#3b82f6',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 2,
    overflow: 'hidden', // 確保圓角效果
  },
  // VVV [修改] 讓主體佔滿大部分空間 VVV
  recordItem: {
    flex: 1, 
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    paddingRight: 10, // 稍微縮小右邊距，給刪除按鈕留空間
  },
  // ^^^ [修改] ^^^
  recordDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    width: 100, // 縮小日期寬度
    marginRight: 10,
  },
  recordPreview: {
    flex: 1,
    fontSize: 14,
    color: '#6b7280',
    overflow: 'hidden',
  },
  recordArrow: {
    marginLeft: 10,
    fontSize: 18,
    color: '#9ca3af',
  },
  // VVV [新增] 刪除按鈕樣式 VVV
  deleteButtonWrapper: {
    width: 65,
    paddingRight: 5,
  },
  // ^^^ [新增] ^^^
  message: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
    color: '#6b7280',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
    gap: 10,
  },
});