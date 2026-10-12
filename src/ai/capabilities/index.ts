// src/ai/capabilities/index.ts

// ============================================================
// EXPORTACIONES EXISTENTES
// ============================================================

export { CapabilityRegistry } from './CapabilityRegistry';
export { CapabilityExecutor } from './executor';

export type {
  CapabilityMetadata,
  CapabilityDefinition,
  CapabilityResult
} from './types';

export type {
  Capability,
  Context,
  Result,
  CapabilityManifest,
  CapabilityGroup
} from './types';

// ============================================================
// REGISTRO DE CAPACIDADES
// ============================================================

import { CapabilityRegistry } from './CapabilityRegistry';
import { PromptCapabilityTool } from './modules/prompt/PromptCapabilityTool';
import { PromptLoader } from '../prompt/PromptBuilder';

/**
 * Crea el registro de capacidades con todas las capacidades disponibles.
 * 
 * Combina:
 * 1. Capacidades nativas (SummaryTool)
 * 2. Capacidades externas (desde JSON + Markdown empaquetados)
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  

  // ============================================================
  // 3. CAPACIDADES EXTERNAS (desde JSON + Markdown empaquetados)
  // ============================================================
  
// Registrar dominios
for (const domain of PromptLoader.loadAllDomains()) {
  registry.registerGroup(domain.id, domain.label);
}

// Registrar capacidades
for (const ext of PromptLoader.loadAllExternalCapabilities()) {
  registry.register(
    new PromptCapabilityTool(
      ext.capability,
      ext.domain
    )
  );
  }
    
  
  
  return registry;
}
