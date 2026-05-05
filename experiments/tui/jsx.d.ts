import type { BoxProps } from './host';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      box: BoxProps & { children?: any; key?: any };
      text: BoxProps & { children?: any; key?: any };
    }
  }
}
