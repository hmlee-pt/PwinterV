/**
 * 生物力學與關節角度計算核心 (Biomechanics & Joint Angle Engine)
 * 專為運動員防受傷篩檢與關節活動度 (ROM) 量測設計
 */

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface AngleResult {
  angle: number;           // 角度 (0 - 180 度)
  isValid: boolean;        // 關鍵點可信度是否達標
  compensation?: string;   // 代償現象描述 (若有)
}

export interface ASLRMeasurement {
  hipFlexionAngle: number;    // 髖關節屈曲角度 (主要活動度指標)
  kneeExtensionAngle: number; // 抬起腿之膝伸展角度 (是否直膝)
  isKneeStraight: boolean;    // 是否直膝 (膝關節 >= 155°)
  supportLegKneeAngle: number;// 支撐腿膝關節角度 (是否彎曲代償)
  isSupportLegFlat: boolean;  // 支撐腿是否平貼 (膝關節 >= 160°)
  compensationWarning?: string;
  confidence: number;
}

export interface MobilityRiskReport {
  rightAngle: number;
  leftAngle: number;
  asymmetryRatio: number; // 左右不對稱差百分比 (%)
  asymmetryDifference: number; // 左右角度絕對差 (度)
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH';
  dominantSide: 'BALANCED' | 'LEFT_TIGHT' | 'RIGHT_TIGHT';
  title: string;
  description: string;
  recommendations: string[];
}

/**
 * 計算 2D 平面上三點之夾角 B (A-B-C)
 * @param a 點 A (如 Shoulder)
 * @param b 點 B 頂點 (如 Hip)
 * @param c 點 C (如 Ankle)
 * @returns 夾角 (0 ~ 180 度)
 */
export function calculateAngle(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);

  if (angle > 180.0) {
    angle = 360.0 - angle;
  }

  return Math.round(angle * 10) / 10;
}

/**
 * 計算單一線段相對於水平地面的傾角
 */
export function calculateSlopeAngle(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y; // 螢幕坐標系向下為正
  const radians = Math.atan2(Math.abs(dy), Math.abs(dx));
  return Math.round(((radians * 180.0) / Math.PI) * 10) / 10;
}

/**
 * 評估 ASLR (主動直膝抬腿) 動作品質與活動度
 * @param landmarks MediaPipe 33 點骨架陣列
 * @param side 測量側別 ('right' | 'left')
 */
export function evaluateASLR(
  landmarks: NormalizedLandmark[],
  side: 'right' | 'left'
): ASLRMeasurement | null {
  if (!landmarks || landmarks.length < 33) return null;

  // MediaPipe Landmark 索引對照
  // 11: left_shoulder, 12: right_shoulder
  // 23: left_hip, 24: right_hip
  // 25: left_knee, 26: right_knee
  // 27: left_ankle, 28: right_ankle
  const isRight = side === 'right';
  const targetShoulder = landmarks[isRight ? 12 : 11];
  const targetHip = landmarks[isRight ? 24 : 23];
  const targetKnee = landmarks[isRight ? 26 : 25];
  const targetAnkle = landmarks[isRight ? 28 : 27];

  const supportHip = landmarks[isRight ? 23 : 24];
  const supportKnee = landmarks[isRight ? 25 : 26];
  const supportAnkle = landmarks[isRight ? 27 : 28];

  // 檢查關鍵點可信度 (visibility)
  const minVis = 0.5;
  const points = [targetShoulder, targetHip, targetKnee, targetAnkle, supportHip, supportKnee, supportAnkle];
  const avgConfidence = points.reduce((acc, p) => acc + (p.visibility ?? 1), 0) / points.length;

  if (targetHip.visibility && targetHip.visibility < minVis) return null;
  if (targetAnkle.visibility && targetAnkle.visibility < minVis) return null;

  // 1. 膝關節伸直角度 (Hip-Knee-Ankle 夾角，正常需接近 180°)
  const kneeExtensionAngle = calculateAngle(targetHip, targetKnee, targetAnkle);
  const isKneeStraight = kneeExtensionAngle >= 155;

  // 2. 支撐腿平貼檢查 (支撐腿不可彎曲代償)
  const supportLegKneeAngle = calculateAngle(supportHip, supportKnee, supportAnkle);
  const isSupportLegFlat = supportLegKneeAngle >= 160;

  // 3. 髖屈曲角度 (Hip Flexion Angle)
  // 當人體平躺時，軀幹與雙腿夾角約 180°。抬起單腿時，夾角縮小。
  // 髖屈曲角 = 180° - 軀幹與腿的夾角 (Shoulder - Hip - Ankle)
  const trunkLegAngle = calculateAngle(targetShoulder, targetHip, targetAnkle);
  let hipFlexionAngle = Math.max(0, Math.round((180.0 - trunkLegAngle) * 10) / 10);

  // 備用計算：若軀幹被遮擋，使用腿部相對地面的傾斜角
  if (hipFlexionAngle > 120 || hipFlexionAngle < 5) {
    const fallbackSlope = calculateSlopeAngle(targetHip, targetAnkle);
    if (fallbackSlope > 0 && fallbackSlope <= 110) {
      hipFlexionAngle = fallbackSlope;
    }
  }

  // 代償警示分析
  let compensationWarning: string | undefined;
  if (!isKneeStraight) {
    compensationWarning = '⚠️ 抬起腿膝蓋彎曲（代償現象，請伸直膝蓋再抬高）';
  } else if (!isSupportLegFlat) {
    compensationWarning = '⚠️ 對側支撐腿離地微彎（請保持支撐腿完全貼平地面）';
  }

  return {
    hipFlexionAngle,
    kneeExtensionAngle,
    isKneeStraight,
    supportLegKneeAngle,
    isSupportLegFlat,
    compensationWarning,
    confidence: avgConfidence,
  };
}

/**
 * 綜合評估左右兩側 ASLR 結果與運動受傷風險 (Injury Risk Assessment)
 */
export function generateMobilityReport(rightAngle: number, leftAngle: number): MobilityRiskReport {
  const diff = Math.round(Math.abs(rightAngle - leftAngle) * 10) / 10;
  const maxAngle = Math.max(rightAngle, leftAngle, 1);
  const asymmetryRatio = Math.round((diff / maxAngle) * 1000) / 10; // 保留一位小數

  let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  let dominantSide: 'BALANCED' | 'LEFT_TIGHT' | 'RIGHT_TIGHT' = 'BALANCED';

  if (diff >= 5) {
    dominantSide = rightAngle < leftAngle ? 'RIGHT_TIGHT' : 'LEFT_TIGHT';
  }

  // 判斷邏輯：
  // 1. 若單側 < 60° 或 左右差 > 15% -> HIGH RISK (高受傷風險)
  // 2. 若單側 60°~74° 或 左右差 10%~15% -> MODERATE (中度受傷風險)
  // 3. 兩側均 >= 75° 且 左右差 < 10% -> LOW RISK (低受傷風險/優良)
  const minAngle = Math.min(rightAngle, leftAngle);

  if (minAngle < 60 || asymmetryRatio > 15) {
    riskLevel = 'HIGH';
  } else if (minAngle < 75 || asymmetryRatio >= 10) {
    riskLevel = 'MODERATE';
  } else {
    riskLevel = 'LOW';
  }

  const recommendations: string[] = [];

  if (riskLevel === 'HIGH') {
    recommendations.push('【避免高強度衝刺】大腿後側膕繩肌緊繃或不對稱明顯，瞬間全力衝刺易導致肌纖維撕裂。');
    if (dominantSide === 'RIGHT_TIGHT') {
      recommendations.push('【強化右側放鬆】使用滾筒針對右側大腿後側與臀大肌進行深層筋膜放鬆（每日 3 組，每組 60 秒）。');
    } else if (dominantSide === 'LEFT_TIGHT') {
      recommendations.push('【強化左側放鬆】使用滾筒針對左側大腿後側與臀大肌進行深層筋膜放鬆（每日 3 組，每組 60 秒）。');
    }
    recommendations.push('【動態神經滑動】實施坐姿直腿神經滑動術 (Sciatic Nerve Flossing)，改善坐骨神經張力。');
  } else if (riskLevel === 'MODERATE') {
    recommendations.push('【運動前動態伸展】進行毛毛蟲爬行 (Inchworm) 與單腳硬舉動態拉伸，活化膕繩肌彈性。');
    if (asymmetryRatio >= 10) {
      recommendations.push(`【平衡兩側活動度】左右兩側活動度落差 ${asymmetryRatio}%，請在較緊繃側多增加 1~2 組伸展。`);
    }
  } else {
    recommendations.push('【狀態優良】兩側後鏈柔軟度與對稱性極佳，請維持當前熱身與放鬆習慣。');
    recommendations.push('【常態保養】深蹲與跑步訓練後，維持常規靜態伸展 30 秒即可。');
  }

  let title = '';
  let description = '';

  switch (riskLevel) {
    case 'HIGH':
      title = '🚨 高度受傷風險警示 (High Injury Risk)';
      description = `偵測到單側角度不足 (${minAngle}°) 或左右側活動度落差顯著 (${asymmetryRatio}%)。研究顯示左右不對稱性 >15% 會使下肢拉傷機率提升 2.5 倍，建議加強放鬆與矯正。`;
      break;
    case 'MODERATE':
      title = '⚠️ 中度受傷風險 (Moderate Risk)';
      description = `柔軟度或對稱性處於邊界值 (最低 ${minAngle}°，不對稱差 ${asymmetryRatio}%)。在疲勞或高負荷運動下可能引發腰椎代償或肌群過載。`;
      break;
    case 'LOW':
      title = '✅ 優良活動度與對稱平衡 (Optimal Mobility)';
      description = `雙腿活動度皆達標 (${rightAngle}° / ${leftAngle}°)，左右對稱良好 (差值 ${asymmetryRatio}%)，具備優秀的運動防護底子！`;
      break;
  }

  return {
    rightAngle,
    leftAngle,
    asymmetryRatio,
    asymmetryDifference: diff,
    riskLevel,
    dominantSide,
    title,
    description,
    recommendations,
  };
}
