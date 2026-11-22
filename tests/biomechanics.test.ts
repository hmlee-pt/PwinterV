import { describe, it, expect } from 'vitest';
import {
  calculateAngle,
  calculateSlopeAngle,
  generateMobilityReport,
  evaluateASLR,
  evaluateDualASLR,
  NormalizedLandmark
} from '../src/biomechanics';

describe('Biomechanics & Angle Math', () => {
  it('should calculate accurate 90 degree angle', () => {
    // A: (0, 1), B: (0, 0), C: (1, 0) -> 90 degrees
    const a: NormalizedLandmark = { x: 0, y: 1 };
    const b: NormalizedLandmark = { x: 0, y: 0 };
    const c: NormalizedLandmark = { x: 1, y: 0 };
    const angle = calculateAngle(a, b, c);
    expect(angle).toBe(90);
  });

  it('should calculate accurate 180 degree straight line', () => {
    // A: (-1, 0), B: (0, 0), C: (1, 0) -> 180 degrees
    const a: NormalizedLandmark = { x: -1, y: 0 };
    const b: NormalizedLandmark = { x: 0, y: 0 };
    const c: NormalizedLandmark = { x: 1, y: 0 };
    const angle = calculateAngle(a, b, c);
    expect(angle).toBe(180);
  });

  it('should calculate slope angle relative to horizontal', () => {
    // 45 degree slope: dx = 1, dy = 1
    const a: NormalizedLandmark = { x: 0, y: 0 };
    const b: NormalizedLandmark = { x: 1, y: 1 };
    const angle = calculateSlopeAngle(a, b);
    expect(angle).toBe(45);
  });
});

describe('Injury Risk Assessment (generateMobilityReport)', () => {
  it('should flag HIGH risk when single side has poor angle (< 60°)', () => {
    const report = generateMobilityReport(55, 80);
    expect(report.riskLevel).toBe('HIGH');
    expect(report.dominantSide).toBe('RIGHT_TIGHT');
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('should flag HIGH risk when asymmetry ratio exceeds 15%', () => {
    // 85 vs 70 -> diff 15, asymmetry 15/85 = 17.6%
    const report = generateMobilityReport(70, 85);
    expect(report.riskLevel).toBe('HIGH');
    expect(report.asymmetryRatio).toBeGreaterThan(15);
    expect(report.dominantSide).toBe('RIGHT_TIGHT');
  });

  it('should flag MODERATE risk when angles are between 60° and 74°', () => {
    const report = generateMobilityReport(68, 70);
    expect(report.riskLevel).toBe('MODERATE');
  });

  it('should flag LOW risk when both sides >= 75° and symmetrical (< 10%)', () => {
    const report = generateMobilityReport(82, 85);
    expect(report.riskLevel).toBe('LOW');
    expect(report.asymmetryRatio).toBeLessThan(10);
    expect(report.dominantSide).toBe('BALANCED');
  });
});

describe('ASLR Evaluation & Compensation Detection', () => {
  it('should return null when landmarks are incomplete', () => {
    const result = evaluateASLR([], 'right');
    expect(result).toBeNull();
  });

  it('should flag knee bending compensation if knee angle < 155°', () => {
    // Generate dummy landmarks array with 33 points
    const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.9,
    }));

    // Target side = right: 12: shoulder, 24: hip, 26: knee, 28: ankle
    landmarks[12] = { x: 0.2, y: 0.5, visibility: 0.9 }; // shoulder
    landmarks[24] = { x: 0.5, y: 0.5, visibility: 0.9 }; // hip
    landmarks[26] = { x: 0.5, y: 0.3, visibility: 0.9 }; // knee bent
    landmarks[28] = { x: 0.7, y: 0.3, visibility: 0.9 }; // ankle bent

    const result = evaluateASLR(landmarks, 'right');
    expect(result).not.toBeNull();
    if (result) {
      expect(result.isKneeStraight).toBe(false);
      expect(result.compensationWarning).toContain('膝蓋彎曲');
    }
  });
});

describe('FMS Scoring Rules (calculateFmsScore)', () => {
  it('should award 3 points when both sides >= 75°', () => {
    const report = generateMobilityReport(80, 85);
    expect(report.fmsRightScore).toBe(3);
    expect(report.fmsLeftScore).toBe(3);
    expect(report.fmsTotalScore).toBe(3);
    expect(report.fmsScoreDescription).toContain('優良');
  });

  it('should take the minimum score (2 points) when one side is 60°-74° and other is >= 75°', () => {
    const report = generateMobilityReport(65, 80);
    expect(report.fmsRightScore).toBe(2);
    expect(report.fmsLeftScore).toBe(3);
    expect(report.fmsTotalScore).toBe(2);
    expect(report.fmsScoreDescription).toContain('活動度受限');
  });

  it('should award 1 point when any side is < 60°', () => {
    const report = generateMobilityReport(55, 68);
    expect(report.fmsRightScore).toBe(1);
    expect(report.fmsLeftScore).toBe(2);
    expect(report.fmsTotalScore).toBe(1);
    expect(report.fmsScoreDescription).toContain('活動度嚴重不足');
  });
});

describe('Smart Dual Leg Auto-Tracking (evaluateDualASLR)', () => {
  function createLyingBodyLandmarks(options: {
    rightLegLifted: boolean;
    leftLegLifted: boolean;
  }): NormalizedLandmark[] {
    const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.95,
    }));

    // Head/Shoulders at x=0.2, y=0.5
    landmarks[11] = { x: 0.2, y: 0.5, visibility: 0.95 }; // left shoulder
    landmarks[12] = { x: 0.2, y: 0.5, visibility: 0.95 }; // right shoulder

    // Hips at x=0.5, y=0.5
    landmarks[23] = { x: 0.5, y: 0.5, visibility: 0.95 }; // left hip
    landmarks[24] = { x: 0.5, y: 0.5, visibility: 0.95 }; // right hip

    // Right leg:
    if (options.rightLegLifted) {
      // Lifted straight up towards ceiling (y=0.15)
      landmarks[26] = { x: 0.5, y: 0.3, visibility: 0.95 }; // right knee
      landmarks[28] = { x: 0.5, y: 0.15, visibility: 0.95 }; // right ankle
    } else {
      // Flat on floor (y=0.5, x=0.8)
      landmarks[26] = { x: 0.65, y: 0.5, visibility: 0.95 };
      landmarks[28] = { x: 0.8, y: 0.5, visibility: 0.95 };
    }

    // Left leg:
    if (options.leftLegLifted) {
      // Lifted straight up towards ceiling (y=0.15)
      landmarks[25] = { x: 0.5, y: 0.3, visibility: 0.95 }; // left knee
      landmarks[27] = { x: 0.5, y: 0.15, visibility: 0.95 }; // left ankle
    } else {
      // Flat on floor (y=0.5, x=0.8)
      landmarks[25] = { x: 0.65, y: 0.5, visibility: 0.95 };
      landmarks[27] = { x: 0.8, y: 0.5, visibility: 0.95 };
    }

    return landmarks;
  }

  it('should auto-swap to right leg when preferred is left but right leg is lifted (resolving 1° bug)', () => {
    // Subject is raising right leg (90°), left leg is flat (0°)
    const landmarks = createLyingBodyLandmarks({ rightLegLifted: true, leftLegLifted: false });

    // App is currently at step 'left'
    const result = evaluateDualASLR(landmarks, 'left');
    expect(result).not.toBeNull();
    // It must detect that right leg is the active one!
    expect(result!.activeSide).toBe('right');
    expect(result!.isOppositeLegLifted).toBe(true);
    expect(result!.activeMeasurement.hipFlexionAngle).toBeGreaterThanOrEqual(80);
  });

  it('should auto-swap to left leg when preferred is right but left leg is lifted', () => {
    // Subject is raising left leg (90°), right leg is flat (0°)
    const landmarks = createLyingBodyLandmarks({ rightLegLifted: false, leftLegLifted: true });

    // App is currently at step 'right'
    const result = evaluateDualASLR(landmarks, 'right');
    expect(result).not.toBeNull();
    expect(result!.activeSide).toBe('left');
    expect(result!.isOppositeLegLifted).toBe(true);
    expect(result!.activeMeasurement.hipFlexionAngle).toBeGreaterThanOrEqual(80);
  });

  it('should stay on preferred side when neither leg is lifted yet (flat on floor)', () => {
    const landmarks = createLyingBodyLandmarks({ rightLegLifted: false, leftLegLifted: false });
    const result = evaluateDualASLR(landmarks, 'right');
    expect(result).not.toBeNull();
    expect(result!.activeSide).toBe('right');
    expect(result!.isOppositeLegLifted).toBe(false);
  });

  it('should stay on preferred side when preferred leg is legitimately lifted', () => {
    const landmarks = createLyingBodyLandmarks({ rightLegLifted: true, leftLegLifted: false });
    const result = evaluateDualASLR(landmarks, 'right');
    expect(result).not.toBeNull();
    expect(result!.activeSide).toBe('right');
    expect(result!.isOppositeLegLifted).toBe(false);
    expect(result!.activeMeasurement.hipFlexionAngle).toBeGreaterThanOrEqual(80);
  });
});
