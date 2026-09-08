/**
 * Impresión tamaño carta (CFDI, cotizaciones carta, etc.).
 * Escritorio: `about:blank` + `document.write` (no URL `blob:`) para que el pie
 * de Chrome no muestre `blob:https://servipos.vercel.app/…`.
 */

function attachLetterPrintHandlers(win: Window, onAfterPrint?: () => void): void {
  const safeClose = () => {
    try {
      onAfterPrint?.();
    } catch {
      /* noop */
    }
    try {
      if (win && !win.closed) win.close();
    } catch {
      /* noop */
    }
  };
  const closeFallback = window.setTimeout(safeClose, 45_000);
  win.addEventListener(
    'afterprint',
    () => {
      window.clearTimeout(closeFallback);
      safeClose();
    },
    { once: true }
  );
}

function printFromHiddenIframeHtml(html: string, printDelayMs: number): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Impresión');
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';

  const tearDown = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  iframe.onload = () => {
    const cw = iframe.contentWindow;
    if (!cw) {
      tearDown();
      return;
    }
    try {
      cw.document.open();
      cw.document.write(html);
      cw.document.close();
    } catch {
      tearDown();
      return;
    }
    cw.addEventListener('afterprint', tearDown, { once: true });
    setTimeout(tearDown, 120_000);
    cw.focus();
    setTimeout(() => {
      try {
        cw.print();
      } catch {
        /* noop */
      }
    }, printDelayMs);
  };

  iframe.src = 'about:blank';
  document.body.appendChild(iframe);
}

export type OpenCfdiLetterPrintOptions = {
  /** Retraso antes de `print()` (ms). Por defecto 380. */
  printDelayMs?: number;
};

/** Documento tamaño carta (CFDI / nómina / carta). */
export function openCfdiLetterPrint(html: string, options?: OpenCfdiLetterPrintOptions): void {
  const printDelayMs = options?.printDelayMs ?? 380;
  const htmlUtf8 = html.startsWith('\uFEFF') ? html : `\uFEFF${html}`;

  const runPrint = (target: Window) => {
    target.focus();
    setTimeout(() => {
      try {
        target.print();
      } catch {
        /* noop */
      }
    }, printDelayMs);
  };

  const w = window.open('about:blank', '_blank', 'width=816,height=1056');
  if (w) {
    try {
      w.document.open();
      w.document.write(htmlUtf8);
      w.document.close();
    } catch {
      try {
        w.close();
      } catch {
        /* noop */
      }
      printFromHiddenIframeHtml(htmlUtf8, printDelayMs);
      return;
    }
    attachLetterPrintHandlers(w);
    if (w.document.readyState === 'complete') runPrint(w);
    else w.addEventListener('load', () => runPrint(w), { once: true });
    return;
  }

  printFromHiddenIframeHtml(htmlUtf8, printDelayMs);
}
