/** Mensagem segura a partir de throw/catch unknown */
export function getErrorMessage(err: unknown, fallback = "Erro"): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}
