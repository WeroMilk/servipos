/**
 * Impresión tamaño carta (CFDI, cotizaciones carta, etc.).
 * Usa URL `blob:` en lugar de `about:blank` + `document.write` para que el navegador
 * no muestre "about:blank" en cabecera/pie o marca al imprimir.
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
  let closeFallback = window.setTimeout(safeClose, 45_000);
  win.addEventListener(
    'afterprint',
    () => {
      window.clearTimeout(closeFallback);
      safeClose();
    },
    { once: true }
  );
}

function printFromHiddenIframeBlob(blobUrl: string, printDelayMs: number, revoke: () => void): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Impresión');
  iframe.style.cssText =
    'position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';

  const tearDown = () => {
    try {
      revoke();
    } catch {
      /* noop */
    }
    if (iframe.parentNode) document.body.removeChild(iframe);
  };

  iframe.onload = () => {
    const cw = iframe.contentWindow;
    if (!cw) {
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

  iframe.src = blobUrl;
  document.body.appendChild(iframe);
}

export type OpenCfdiLetterPrintOptions = {
  /** Retraso antes de `print()` (ms). Por defecto 380. */
  printDelayMs?: number;
};

/** Documento tamaño carta (CFDI / nómina / carta desde `printLetterDocument`). */
export function openCfdiLetterPrint(html: string, options?: OpenCfdiLetterPrintOptions): void {
  const printDelayMs = options?.printDelayMs ?? 380;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  };

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

  const w = window.open(url, '_blank', 'width=816,height=1056');
  if (w) {
    attachLetterPrintHandlers(w, revoke);
    const start = () => runPrint(w);
    if (w.document.readyState === 'complete') start();
    else w.addEventListener('load', start, { once: true });
    return;
  }

  printFromHiddenIframeBlob(url, printDelayMs, revoke);
}
