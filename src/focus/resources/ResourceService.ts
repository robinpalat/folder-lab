// src/focus/resources/ResourceService.ts

import { App, TFile, TFolder, Notice } from 'obsidian';
import { Resource, ResourceMetadata } from './Resource';

const RESOURCES_FOLDER = '_resources';
const RESOURCE_METADATA_FILE = '_resources.json';

export class ResourceService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private getResourcesFolderPath(folderPath: string): string {
    return `${folderPath}/${RESOURCES_FOLDER}`;
  }

  private getMetadataPath(folderPath: string): string {
    return `${folderPath}/${RESOURCE_METADATA_FILE}`;
  }

  private async ensureResourcesFolder(folderPath: string): Promise<void> {
    const resourcesPath = this.getResourcesFolderPath(folderPath);
    const exists = await this.app.vault.adapter.exists(resourcesPath);
    if (!exists) {
      await this.app.vault.adapter.mkdir(resourcesPath);
    }
  }

  async loadMetadata(folderPath: string): Promise<ResourceMetadata | null> {
    const path = this.getMetadataPath(folderPath);
    const file = this.app.vault.getFileByPath(path);
    
    if (!file) {
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      const data = JSON.parse(content);
      return data as ResourceMetadata;
    } catch (error) {
      console.warn('Error loading resource metadata:', error);
      return null;
    }
  }

  // vault.modify o vault.create según corresponda
  async saveMetadata(folderPath: string, metadata: ResourceMetadata): Promise<void> {
    const path = this.getMetadataPath(folderPath);
    const content = JSON.stringify(metadata, null, 2);
    
    try {
      const file = this.app.vault.getFileByPath(path);
      if (file) {
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(path, content);
      }
    } catch (error) {
      console.error('Error saving resource metadata:', error);
      throw error;
    }
  }

  async getResources(folderPath: string): Promise<Resource[]> {
    const metadata = await this.loadMetadata(folderPath);
    return metadata?.resources || [];
  }

  async addResource(folderPath: string, resource: Resource): Promise<void> {
    await this.ensureResourcesFolder(folderPath);

    let metadata = await this.loadMetadata(folderPath);
    if (!metadata) {
      metadata = { resources: [], version: 1 };
    }

    // Verificar duplicados
    const exists = metadata.resources.some(r => {
      if (resource.type === 'file' && r.type === 'file') {
        return r.source === resource.source;
      }
      if (resource.type === 'link' && r.type === 'link') {
        return r.url === resource.url;
      }
      return false;
    });

    if (exists) {
      throw new Error('Este recurso ya existe');
    }

    metadata.resources.push(resource);
    metadata.version = (metadata.version || 1) + 1;

    await this.saveMetadata(folderPath, metadata);
  }

  async updateResource(folderPath: string, resourceId: string, updates: Partial<Resource>): Promise<void> {
    const metadata = await this.loadMetadata(folderPath);
    if (!metadata) {
      throw new Error('No se encontró metadata');
    }

    const index = metadata.resources.findIndex(r => r.id === resourceId);
    if (index === -1) {
      throw new Error('Recurso no encontrado');
    }

    metadata.resources[index] = { ...metadata.resources[index], ...updates, updatedAt: Date.now() };
    metadata.version = (metadata.version || 1) + 1;

    await this.saveMetadata(folderPath, metadata);
  }

  async deleteResource(folderPath: string, resourceId: string): Promise<void> {
    const metadata = await this.loadMetadata(folderPath);
    if (!metadata) {
      throw new Error('No se encontró metadata');
    }

    const resource = metadata.resources.find(r => r.id === resourceId);
    if (!resource) {
      throw new Error('Recurso no encontrado');
    }

    metadata.resources = metadata.resources.filter(r => r.id !== resourceId);
    metadata.version = (metadata.version || 1) + 1;

    await this.saveMetadata(folderPath, metadata);
  }

  async getAllResources(folderPath: string): Promise<Resource[]> {
    await this.ensureResourcesFolder(folderPath);

    let metadata = await this.loadMetadata(folderPath);
    const registeredResources = metadata?.resources || [];

    const resourcesPath = this.getResourcesFolderPath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(resourcesPath);
    
    const fileResources: Resource[] = [];
    
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile) {
          const existing = registeredResources.find(r => r.type === 'file' && r.source === child.path);
          if (!existing) {
            const newResource: Resource = {
              id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'file',
              title: child.basename,
              source: child.path,
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            fileResources.push(newResource);
            
            try {
              if (!metadata) {
                metadata = { resources: [], version: 1 };
              }
              metadata.resources.push(newResource);
              metadata.version = (metadata.version || 1) + 1;
              await this.saveMetadata(folderPath, metadata);
            } catch (error) {
              console.warn('Error auto-registering file:', error);
            }
          }
        }
      }
    }

    const updatedMetadata = await this.loadMetadata(folderPath);
    return updatedMetadata?.resources || [];
  }

  async validateResource(folderPath: string, resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ valid: boolean; error?: string }> {
    if (resource.type === 'file') {
      if (!resource.source) {
        return { valid: false, error: 'La ruta del archivo es requerida' };
      }
      const file = this.app.vault.getFileByPath(resource.source);
      if (!file) {
        return { valid: false, error: 'El archivo no existe en el vault' };
      }
    }

    if (resource.type === 'link') {
      if (!resource.url) {
        return { valid: false, error: 'La URL es requerida' };
      }
      if (!resource.url.startsWith('http://') && !resource.url.startsWith('https://')) {
        return { valid: false, error: 'La URL debe comenzar con http:// o https://' };
      }
    }

    if (!resource.title || resource.title.trim() === '') {
      return { valid: false, error: 'El nombre del recurso es requerido' };
    }

    return { valid: true };
  }
}
