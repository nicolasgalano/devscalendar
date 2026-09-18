/**
 * Formateo de tamaños de archivo — util para el panel de adjuntos de 020.
 *
 * Devuelve algo tipo "1.4 MB", "250 KB", "3 B". Usa 1024 como base (KB
 * binario) porque coincide con `filesize` que muestran los file managers
 * y evita la confusión de "por qué mi 5 MB dice 4.77".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  // 1 decimal a partir de MB, sin decimales en B/KB (los bytes chicos
  // no ganan legibilidad con decimales).
  const formatted =
    index === 0 || index === 1
      ? Math.round(value).toString()
      : value.toFixed(1);
  return `${formatted} ${units[index]}`;
}
