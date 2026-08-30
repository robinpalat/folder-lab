/**
 * Resultado del conteo de palabras del libro
 */
export interface WordCountResult {
  /** Total de palabras en todo el libro */
  totalWords: number;
  
  /** Total de notas contadas */
  totalNotes: number;
  
  /** Promedio de palabras por nota */
  avgWords: number;
  
  /** Nota con más palabras */
  maxWords: { name: string; words: number };
  
  /** Nota con menos palabras */
  minWords: { name: string; words: number };
  
  /** Detalle por nota (ruta y palabras) */
  details: { name: string; words: number }[];
}
