import { colorAt } from './quality.js';

export class MapView {
  constructor(elementId) {
    this.map = L.map(elementId).setView([46.6, 2.3], 6); // centre France par défaut
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.segmentLayers = [];
    this.hasFitOnce = false;
  }

  clear() {
    this.segmentLayers.forEach((layer) => this.map.removeLayer(layer));
    this.segmentLayers = [];
    this.hasFitOnce = false;
  }

  render(pings, settings) {
    this.clear();
    const withPos = pings.filter((p) => p.startLat != null && p.startLng != null);
    if (withPos.length === 0) return;

    // On dessine un segment par paire de pings consécutifs, coloré selon la
    // fenêtre glissante se terminant sur le second point du segment.
    for (let i = 1; i < pings.length; i++) {
      const a = pings[i - 1];
      const b = pings[i];
      const posA = pointOf(a);
      const posB = pointOf(b);
      if (!posA || !posB) continue;

      const color = colorAt(pings, i, settings);
      const line = L.polyline([posA, posB], { color, weight: 5, opacity: 0.85 }).addTo(this.map);
      this.segmentLayers.push(line);
    }

    // point isolé si un seul ping a une position
    if (withPos.length === 1) {
      const marker = L.circleMarker(pointOf(withPos[0]), { radius: 6, color: '#2f9e44' }).addTo(this.map);
      this.segmentLayers.push(marker);
    }

    const bounds = L.latLngBounds(withPos.map(pointOf));
    if (!this.hasFitOnce) {
      this.map.fitBounds(bounds, { maxZoom: 14 });
      this.hasFitOnce = true;
    }
  }

  // Pendant l'enregistrement, on recentre en continu sur le dernier point.
  panTo(ping) {
    const pos = pointOf(ping);
    if (pos) this.map.panTo(pos, { animate: true });
  }
}

function pointOf(ping) {
  // Priorité à la position de résolution (plus proche de l'endroit réel où
  // le résultat du ping s'est confirmé), avec repli sur la position de départ.
  if (ping.endLat != null && ping.endLng != null) return [ping.endLat, ping.endLng];
  if (ping.startLat != null && ping.startLng != null) return [ping.startLat, ping.startLng];
  return null;
}
