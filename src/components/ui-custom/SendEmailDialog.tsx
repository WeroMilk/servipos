import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openHotmailCompose, SERVIPARTZ_SENDER_EMAIL } from '@/lib/hotmailCompose';
import { useAppStore } from '@/stores';

type SendEmailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  body: string;
  title?: string;
};

export function SendEmailDialog({
  open,
  onOpenChange,
  subject,
  body,
  title = 'Enviar por correo',
}: SendEmailDialogProps) {
  const { addToast } = useAppStore();
  const [to, setTo] = useState('');

  useEffect(() => {
    if (open) setTo('');
  }, [open]);

  const handleSend = () => {
    const email = to.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addToast({ type: 'error', message: 'Ingrese un correo válido' });
      return;
    }
    openHotmailCompose(email, subject, body);
    addToast({
      type: 'success',
      message: `Se abrió Outlook. Envíe desde ${SERVIPARTZ_SENDER_EMAIL} si tiene esa cuenta iniciada.`,
    });
    onOpenChange(false);
    setTo('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-600 dark:text-slate-500">
          Remitente previsto: <span className="text-cyan-400/90">{SERVIPARTZ_SENDER_EMAIL}</span> — inicie sesión en Outlook
          con esa cuenta en el navegador para que el envío salga desde ella.
        </p>
        <div className="space-y-2 py-2">
          <Label htmlFor="send-email-to">Correo del destinatario</Label>
          <Input
            id="send-email-to"
            type="email"
            autoComplete="email"
            placeholder="cliente@ejemplo.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border-slate-300 dark:border-slate-700 bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            onClick={handleSend}
          >
            <Send className="mr-2 h-4 w-4" />
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
