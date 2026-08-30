// ============================================================
// ROMAN UTILS
// ============================================================
// Conversión a números romanos
// ============================================================

/**
 * Convierte un número a su representación en números romanos
 * @param num Número a convertir (1-3999)
 */
export function toRoman(num: number): string {
  if (num <= 0) return '0';
  if (num >= 4000) return num.toString();
  
  const romanNumerals = [
    { value: 1000, symbol: 'M' },
    { value: 900, symbol: 'CM' },
    { value: 500, symbol: 'D' },
    { value: 400, symbol: 'CD' },
    { value: 100, symbol: 'C' },
    { value: 90, symbol: 'XC' },
    { value: 50, symbol: 'L' },
    { value: 40, symbol: 'XL' },
    { value: 10, symbol: 'X' },
    { value: 9, symbol: 'IX' },
    { value: 5, symbol: 'V' },
    { value: 4, symbol: 'IV' },
    { value: 1, symbol: 'I' }
  ];
  
  let result = '';
  let remaining = num;
  
  for (const numeral of romanNumerals) {
    while (remaining >= numeral.value) {
      result += numeral.symbol;
      remaining -= numeral.value;
    }
  }
  
  return result;
}

/**
 * Convierte un número a su representación en números romanos (versión alternativa)
 * Usa toRoman() internamente
 */
export function toRomanAlternative(num: number): string {
  if (num <= 0) return '0';
  
  const roman = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  const values = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  
  let result = '';
  let remaining = num;
  
  for (let i = 0; i < values.length; i++) {
    while (remaining >= values[i]) {
      result += roman[i];
      remaining -= values[i];
    }
  }
  
  return result;
}

/**
 * Verifica si un string es un número romano válido
 */
export function isValidRoman(str: string): boolean {
  const romanPattern = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  return romanPattern.test(str);
}
