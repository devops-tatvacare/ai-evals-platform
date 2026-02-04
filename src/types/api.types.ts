export interface GeminiApiVitals {
  temperature: string;
  pulse: string;
  respRate: string;
  bloodPressure: string;
  spo2: string;
  ofc: string;
  height: string;
  weight: string;
}

export interface GeminiApiSymptom {
  name: string;
  duration: string;
  severity: string;
  notes: string;
}

export interface GeminiApiDiagnosis {
  name: string;
  since: string;
  status: string;
  notes: string;
}

export interface GeminiApiMedication {
  name: string;
  dosage: string;
  frequency: string;
  schedule: string;
  duration: string;
  quantity: number;
  notes: string;
}

export interface GeminiApiMedicalHistory {
  type: string;
  name: string;
  duration: string;
  relation: string;
  notes: string;
}

export interface GeminiApiRx {
  vitalsAndBodyComposition: GeminiApiVitals;
  symptoms: GeminiApiSymptom[];
  examinations: unknown[];
  diagnosis: GeminiApiDiagnosis[];
  medications: GeminiApiMedication[];
  vaccinations: unknown[];
  labResults: unknown[];
  medicalHistory: GeminiApiMedicalHistory[];
  advice: unknown[];
  labInvestigation: unknown[];
  followUp: string;
  dynamicFields: Record<string, unknown>;
  others: unknown[];
}

export interface GeminiApiResponse {
  success: boolean;
  input: string;
  rx: GeminiApiRx;
  specialty: string;
  correctedname: string | null;
  
  fetchedAt: Date;
  apiVersion?: string;
}
