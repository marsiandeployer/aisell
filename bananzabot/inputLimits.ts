export const MAX_SINGLE_MESSAGE_INPUT_CHARS = 3500;

export function validateSingleMessageInputLength(text: string): { ok: boolean; message?: string } {
  if (typeof text !== 'string') return { ok: true };
  if (text.length <= MAX_SINGLE_MESSAGE_INPUT_CHARS) return { ok: true };
  return {
    ok: false,
    message: `Слишком длинное сообщение. Отправьте описание одним сообщением до ${MAX_SINGLE_MESSAGE_INPUT_CHARS} символов из-за ограничения Telegram.`,
  };
}

