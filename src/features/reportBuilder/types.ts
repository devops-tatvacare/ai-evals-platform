export interface BuilderSection {
  id: string;
  type: string;
  title: string;
  variant?: string;
}

export interface ComposedReport {
  reportName: string;
  sections: BuilderSection[];
}

export interface BuilderMessage {
  role: 'user' | 'assistant';
  content: string;
  composedReport?: ComposedReport | null;
}

export interface BuilderChatRequest {
  appId: string;
  sessionId: string | null;
  message: string;
  provider: string;
  model: string;
}

export interface BuilderChatResponse {
  sessionId: string;
  role: string;
  content: string;
  composedReport: ComposedReport | null;
}
