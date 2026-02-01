import type { SchemaDefinition } from '@/types';

export const DEFAULT_TRANSCRIPTION_SCHEMA: Omit<SchemaDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'Standard Transcript Schema',
  version: 1,
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
  version: 1,
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
            segmentIndex: { type: 'number' },
            originalText: { type: 'string', description: 'Text from original AI transcript' },
            judgeText: { type: 'string', description: 'Text from judge AI transcript' },
            discrepancy: { type: 'string', description: 'Description of difference or "Match"' },
            likelyCorrect: { 
              type: 'string', 
              enum: ['original', 'judge', 'both', 'unclear'],
              description: 'Which transcript is likely correct'
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in the determination'
            },
            severity: { 
              type: 'string', 
              enum: ['none', 'minor', 'moderate', 'critical'] 
            },
            category: { type: 'string' },
          },
          required: ['segmentIndex', 'discrepancy', 'likelyCorrect', 'severity'],
        },
      },
      overallAssessment: { type: 'string' },
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
      },
    },
    required: ['segments', 'overallAssessment'],
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
