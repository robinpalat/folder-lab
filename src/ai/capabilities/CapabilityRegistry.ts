import { Capability, CapabilityGroup } from './types';

/**
 * Registro de capacidades.
 * 
 * Los grupos se descubren automáticamente a partir de las capacidades registradas.
 * No es necesario definirlos explícitamente.
 */
export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();
  private groupLabels: Map<string, string> = new Map();

  register(capability: Capability): void {
    this.capabilities.set(capability.id, capability);
    // Registrar grupo si no existe
    if (!this.groupLabels.has(capability.group)) {
      this.groupLabels.set(capability.group, capability.group);
    }
  }

  /**
   * Registrar un grupo con etiqueta personalizada.
   * Opcional: si no se define, se usa el ID como label.
   */
  registerGroup(id: string, label: string): void {
    this.groupLabels.set(id, label);
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  getAll(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  getByGroup(groupId: string): Capability[] {
    return this.getAll()
      .filter(c => c.group === groupId)
      .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  /**
   * Grupos descubiertos automáticamente.
   */
  getGroups(): CapabilityGroup[] {
    const groupIds = new Set(this.getAll().map(c => c.group));
    return Array.from(groupIds).map(id => ({
      id,
      label: this.groupLabels.get(id) || id
    }));
  }

  getDefaultGroup(): string {
    const groups = this.getGroups();
    return groups.length > 0 ? groups[0].id : '';
  }
}
