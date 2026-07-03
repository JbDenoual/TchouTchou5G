// Calcule la couleur d'un point à partir d'une fenêtre glissante de pings
// (succès + latence), plutôt que du seul dernier ping — évite qu'un raté
// isolé au milieu d'une bonne zone colore tout en rouge.

export const COLORS = {
  red: '#e03131',
  orange: '#f08c00',
  yellow: '#f5c518',
  green: '#2f9e44',
};

export function windowFor(pings, index, windowSize) {
  const start = Math.max(0, index - windowSize + 1);
  return pings.slice(start, index + 1);
}

export function colorForWindow(windowPings, thresholds) {
  if (windowPings.length === 0) return COLORS.red;

  const successCount = windowPings.filter((p) => p.success).length;
  const successRate = successCount / windowPings.length;

  if (successRate < thresholds.redMaxSuccessRate) return COLORS.red;
  if (successRate < thresholds.orangeMaxSuccessRate) return COLORS.orange;

  const successful = windowPings.filter((p) => p.success);
  const avgLatency =
    successful.reduce((sum, p) => sum + p.elapsedMs, 0) / (successful.length || 1);

  if (avgLatency > thresholds.yellowMinLatencyMs) return COLORS.yellow;
  return COLORS.green;
}

export function colorAt(pings, index, settings) {
  const win = windowFor(pings, index, settings.rollingWindowSize);
  return colorForWindow(win, settings.thresholds);
}

export function tripSummary(pings, settings) {
  const counts = { red: 0, orange: 0, yellow: 0, green: 0 };
  const nameByColor = { [COLORS.red]: 'red', [COLORS.orange]: 'orange', [COLORS.yellow]: 'yellow', [COLORS.green]: 'green' };

  pings.forEach((_, i) => {
    const color = colorAt(pings, i, settings);
    counts[nameByColor[color]] += 1;
  });

  const total = pings.length || 1;
  return {
    counts,
    percentages: {
      red: Math.round((counts.red / total) * 100),
      orange: Math.round((counts.orange / total) * 100),
      yellow: Math.round((counts.yellow / total) * 100),
      green: Math.round((counts.green / total) * 100),
    },
  };
}
