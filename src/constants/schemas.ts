import type { SchemaDefinition } from '@/types';

export const DEFAULT_TRANSCRIPTION_SCHEMA: Omit<SchemaDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Standard Transcript Schema',
  version: 2, // v2: Ensured startTime/endTime are required
  promptType: 'transcription',
  isDefault: true,
  description: 'Default schema for time-aligned transcription output with segments',
  schema: {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            speaker: { type: 'string', description: 'Speaker identifier (e.g., Doctor, Patient)' },
            text: { type: 'string', description: 'Transcribed text for this time window' },
            startTime: { type: 'string', description: 'Start time in HH:MM:SS format' },
            endTime: { type: 'string', description: 'End time in HH:MM:SS format' },
          },
          required: ['speaker', 'text', 'startTime', 'endTime'],
        },
      },
    },
    required: ['segments'],
  },
};

export const DEFAULT_EVALUATION_SCHEMA: Omit<SchemaDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Standard Evaluation Schema',
  version: 3, // v3: Added assessmentReferences for clickable segment navigation
  promptType: 'evaluation',
  isDefault: true,
  description: 'LLM-as-Judge evaluation schema with likelyCorrect determination',
  schema: {
    type: 'object',
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            segmentIndex: { type: 'number', description: 'Zero-based index of segment' },
            originalText: { type: 'string', description: 'Text from original AI transcript' },
            judgeText: { type: 'string', description: 'Text from judge AI transcript' },
            discrepancy: { type: 'string', description: 'Description of difference or "Match"' },
            likelyCorrect: { 
              type: 'string', 
              enum: ['original', 'judge', 'both', 'unclear'],
              description: 'Which transcript is likely correct based on audio'
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in the determination'
            },
            severity: { 
              type: 'string', 
              enum: ['none', 'minor', 'moderate', 'critical'],
              description: 'Clinical impact severity of any discrepancy'
            },
            category: { type: 'string', description: 'Error category (e.g., dosage, speaker, terminology)' },
          },
          required: ['segmentIndex', 'originalText', 'judgeText', 'discrepancy', 'likelyCorrect', 'severity'],
        },
      },
      overallAssessment: { type: 'string', description: 'Summary of overall transcript quality with specific observations' },
      assessmentReferences: {
        type: 'array',
        description: 'Specific segment references for key observations mentioned in the assessment',
        items: {
          type: 'object',
          properties: {
            segmentIndex: { type: 'number', description: 'Zero-based index of the referenced segment' },
            timeWindow: { type: 'string', description: 'Time window in format "HH:MM:SS - HH:MM:SS"' },
            issue: { type: 'string', description: 'Brief description of the issue at this segment' },
            severity: { 
              type: 'string', 
              enum: ['none', 'minor', 'moderate', 'critical'],
              description: 'Severity of this specific issue'
            },
          },
          required: ['segmentIndex', 'timeWindow', 'issue', 'severity'],
        },
      },
      statistics: {
        type: 'object',
        properties: {
          totalSegments: { type: 'number' },
          criticalCount: { type: 'number' },
          moderateCount: { type: 'number' },
          minorCount: { type: 'number' },
          matchCount: { type: 'number' },
          originalCorrectCount: { type: 'number' },
          judgeCorrectCount: { type: 'number' },
          unclearCount: { type: 'number' },
        },
        required: ['totalSegments', 'criticalCount', 'moderateCount', 'minorCount', 'matchCount'],
      },
    },
    required: ['segments', 'overallAssessment', 'assessmentReferences', 'statistics'],
  },
};

export const DEFAULT_EXTRACTION_SCHEMA: Omit<SchemaDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Standard Extraction Schema',
  version: 1,
  promptType: 'extraction',
  isDefault: true,
  description: 'Default schema for data extraction output',
  schema: {
    type: 'object',
    properties: {
      data: { type: 'object' },
      confidence: { type: 'number' },
    },
    required: ['data'],
  },
};
