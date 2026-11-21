import { describe, it, expect } from 'vitest';
import {
  calculateAngle,
  calculateSlopeAngle,
  generateMobilityReport,
  evaluateASLR,
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
