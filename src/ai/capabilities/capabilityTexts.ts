// ============================================================
// CAPABILITY TEXTS
// ============================================================
// Resuelve los textos de PRESENTACIÓN de dominios y capacidades
// de IA (etiquetas y descripciones visibles en los navegadores
// de capacidades) desde el catálogo i18n, usando los ids
// estables de los JSON de dominios. Los JSON de prompts y los
// ids NO se traducen ni se modifican; si una clave falta, se
// conserva el valor heredado como fallback.
// ============================================================

import { i18n } from '../../i18n/I18nService';

const DOMAIN_KEYS: Record<string, string> = {
  investigacion: 'domains.research',
  revision: 'domains.review',
  transformacion: 'domains.transform'
};

const CAPABILITY_KEYS: Record<string, string> = {
  'research-questions': 'domains.research.capabilities.questions',
  'research-references': 'domains.research.capabilities.references',
  'research-concepts': 'domains.research.capabilities.concepts',
  'research-thesis': 'domains.research.capabilities.thesis',
  'review-clarity': 'domains.review.capabilities.clarity',
  'review-coherence': 'domains.review.capabilities.coherence',
  'transform-outline': 'domains.transform.capabilities.outline',
  'transform-mindmap': 'domains.transform.capabilities.mindmap',
  'transform-study-questions': 'domains.transform.capabilities.studyQuestions'
};

function resolve(
  key: string | undefined,
  fallback: string
): string {
  if (key && i18n.has(key)) return i18n.t(key);
  return fallback;
}

/** Etiqueta visible de un dominio (id: investigacion/revision/transformacion). */
export function getDomainLabel(id: string, fallback: string): string {
  const base = DOMAIN_KEYS[id];
  return resolve(base ? `${base}.label` : undefined, fallback);
}

/** Descripción visible de un dominio. */
export function getDomainDescription(id: string, fallback: string): string {
  const base = DOMAIN_KEYS[id];
  return resolve(base ? `${base}.description` : undefined, fallback);
}

/** Etiqueta visible de una capacidad (id: research-questions, …). */
export function getCapabilityLabel(id: string, fallback: string): string {
  return resolve(CAPABILITY_KEYS[id] ? `${CAPABILITY_KEYS[id]}.label` : undefined, fallback);
}

/** Descripción visible de una capacidad. */
export function getCapabilityDescription(id: string, fallback: string): string {
  return resolve(CAPABILITY_KEYS[id] ? `${CAPABILITY_KEYS[id]}.description` : undefined, fallback);
}
