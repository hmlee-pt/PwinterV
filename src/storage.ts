/**
 * 本機紀錄儲存模組 (Local Storage & History Manager)
 * 遵循隱私第一原則：所有受測者運動數據皆儲存於使用者手機本地
 */

import { MobilityRiskReport } from './biomechanics';

export interface AssessmentRecord {
  id: string;
  timestamp: number;
  dateStr: string;
  athleteName: string;
  report: MobilityRiskReport;
}

const STORAGE_KEY = 'athletic_mobility_records_v1';

export function saveAssessmentRecord(
  athleteName: string,
  report: MobilityRiskReport
): AssessmentRecord {
  const records = getAssessmentRecords();
  const newRecord: AssessmentRecord = {
    id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    dateStr: new Date().toLocaleString('zh-TW', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    athleteName: athleteName.trim() || '未命名運動員',
    report,
  };

  records.unshift(newRecord);
  // 保留最新 50 筆紀錄
  if (records.length > 50) {
    records.length = 50;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('儲存紀錄失敗:', e);
  }

  return newRecord;
}

export function getAssessmentRecords(): AssessmentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function clearAssessmentRecords() {
  localStorage.removeItem(STORAGE_KEY);
}
