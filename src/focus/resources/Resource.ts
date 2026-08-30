
export type ResourceType = 'file' | 'link';

export interface Resource {
  id: string;
  type: ResourceType;
  title: string;
  description?: string;
  source?: string;        // Para archivos: ruta en el vault
  url?: string;           // Para enlaces: URL externa
  tags?: string[];
  active?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ResourceMetadata {
  resources: Resource[];
  version: number;
}
