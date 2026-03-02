export interface WorkflowTheme {
  accentVar: string;
  surfaceVar: string;
  borderVar: string;
}

export const workflowThemes = {
  voiceRx: {
    accentVar: "--workflow-voice-accent",
    surfaceVar: "--workflow-voice-surface",
    borderVar: "--workflow-voice-border",
  },
  kairaBot: {
    accentVar: "--workflow-kaira-accent",
    surfaceVar: "--workflow-kaira-surface",
    borderVar: "--workflow-kaira-border",
  },
} as const;
