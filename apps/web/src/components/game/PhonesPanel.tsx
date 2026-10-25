import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** The QR code in public/qr-room.svg encodes this URL (regenerate it after a domain change). */
export const QR_ORIGIN = 'https://gridcast-028f.fly.dev';

/**
 * Phones in the room: a QR code on the projector turns each phone into a personal radio for
 * this game, in step with the screen.
 */
export function PhonesPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const origin = window.location.origin;
  const link = `${origin}/r`;
  const showQr = origin === QR_ORIGIN;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Follow on your phone"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col items-center gap-4 rounded-md bg-card p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center">
          <h2 className="display text-2xl">Follow on your phone</h2>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </div>
        {showQr && (
          <img
            src="/qr-room.svg"
            alt={`QR code for ${link}`}
            className="aspect-square w-64 max-w-full rounded-md bg-white p-2"
          />
        )}
        <p className="display text-3xl break-all">{link.replace(/^https?:\/\//, '')}</p>
        <p className="text-sm text-muted-foreground">
          Your phone becomes a radio for this game: large text, your language, the announcers, and a
          buzz on big plays (Android). It follows this screen.
        </p>
      </div>
    </div>
  );
}
