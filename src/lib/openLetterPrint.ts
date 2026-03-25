/**
 * Abre ventana carta para impresión de representación CFDI (misma mecánica que tickets).
 * Extraído para evitar dependencia circular con `cfdiRepresentacionImpresa`.
 */
function attachLetterPrintHandlers(win: Window): void {
  const safeClose = () => {
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

function printFromHiddenIframe(html: string, printDelayMs: number): void {
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

/** Documento tamaño carta (CFDI / nómina) — misma lógica que `printTicket` interno. */
export function openCfdiLetterPrint(html: string): void {
  const printDelayMs = 380;
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
      w.document.write(html);
      w.document.close();
    } catch {
      try {
        w.close();
      } catch {
        /* noop */
      }
      printFromHiddenIframe(html, printDelayMs);
      return;
    }

    attachLetterPrintHandlers(w);
    const start = () => runPrint(w);
    if (w.document.readyState === 'complete') start();
    else w.addEventListener('load', start, { once: true });
    return;
  }

  printFromHiddenIframe(html, printDelayMs);
}
