export const Z_INDEX = {
  CANVAS: 0,
  OVERLAY: 10,
  FLOATING: 20,
  HEADER: 30,
  DROPDOWN: 40,
  MODAL: 50,
  TOAST: 60,
} as const;

export type ZIndexLayer = keyof typeof Z_INDEX;
