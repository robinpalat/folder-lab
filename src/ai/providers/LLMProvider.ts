
import { AIRequest, AIResponse } from '../types';

export interface LLMProvider {
  id: string;
  name: string;
  chat(request: AIRequest): Promise<AIResponse>;
  testConnection(): Promise<boolean>;
  getDefaultModel(): string;
}
