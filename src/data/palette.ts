/** The six "pens". First entry is the default ink (matches v1 text color). */
export const PALETTE = [
  { id: 'ink', css: '#2c2412', label: 'Чернильный' },
  { id: 'red', css: '#c43c3c', label: 'Красный' },
  { id: 'blue', css: '#2e5aac', label: 'Синий' },
  { id: 'green', css: '#3a7d44', label: 'Зелёный' },
  { id: 'purple', css: '#7b4fa6', label: 'Фиолетовый' },
  { id: 'orange', css: '#d07a2e', label: 'Оранжевый' },
] as const;

export type PenId = (typeof PALETTE)[number]['id'];
export const DEFAULT_PEN: PenId = 'ink';
