import { useEffect } from 'react';

/**
 * Escritorio (lg+): la rueda del mouse desplaza también el scroll horizontal en
 * elementos con data-wheel-scroll-x:
 * - `strip` (por defecto): deltaY (y deltaX de trackpad) mueve scrollLeft — útil en filas de pestañas.
 * - `table`: mismo comportamiento para tablas anchas; además respeta shift+rueda en navegadores que ya lo mapean.
 */
export function useDesktopWheelScrollEnhancer() {
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');

    const onWheel = (e: WheelEvent) => {
      if (!mq.matches) return;

      const t = e.target;
      if (!(t instanceof Element)) return;

      const el = t.closest<HTMLElement>('[data-wheel-scroll-x]');
      if (!el) return;

      if (el.scrollWidth <= el.clientWidth + 1) return;

      const mode = el.dataset.wheelScrollX || 'strip';
      const dy = e.deltaY;
      const dx = e.deltaX;

      if (mode === 'table') {
        if (Math.abs(dx) > Math.abs(dy) && dx !== 0) {
          el.scrollLeft += dx;
          e.preventDefault();
          return;
        }
        if (e.shiftKey && dy !== 0) {
          el.scrollLeft += dy;
          e.preventDefault();
          return;
        }
        if (!e.shiftKey && Math.abs(dy) >= Math.abs(dx) && dy !== 0) {
          el.scrollLeft += dy;
          e.preventDefault();
        }
        return;
      }

      // strip
      const delta = dy !== 0 ? dy : dx;
      if (delta !== 0) {
        el.scrollLeft += delta;
        e.preventDefault();
      }
    };

    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);
}
