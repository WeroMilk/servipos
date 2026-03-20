/** Cuenta oficial indicada para envíos desde la app (el usuario debe tener sesión en Outlook con esta cuenta). */
export const SERVIPARTZ_SENDER_EMAIL = 'servipartz@hotmail.com';

/**
 * Abre Outlook en el navegador con redacción lista (para, asunto, cuerpo).
 * El envío real sale desde la cuenta con la que esté iniciada sesión en outlook.live.com.
 */
export function openHotmailCompose(to: string, subject: string, body: string): void {
  const params = new URLSearchParams();
  params.set('to', to.trim());
  params.set('subject', subject);
  params.set('body', body);
  const url = `https://outlook.live.com/mail/0/deeplink/compose?${params.toString()}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
