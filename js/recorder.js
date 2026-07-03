import { supabase } from './supabaseClient.js';
import { pingOnce } from './ping.js';
import { outboxAdd, outboxGetAll, outboxRemove } from './db.js';
import { newTripId, newPingId } from './trips.js';

const SYNC_INTERVAL_MS = 10000;

export class Recorder {
  constructor({ settings, onPing, onStatus }) {
    this.settings = settings;
    this.onPing = onPing || (() => {});
    this.onStatus = onStatus || (() => {});
    this.pings = [];
    this.tripId = null;
    this.currentPosition = null;
    this.watchId = null;
    this.intervalId = null;
    this.syncIntervalId = null;
    this.wakeLockSentinel = null;
    this._onlineHandler = () => this.syncOutbox();
  }

  async start(userId, tripName) {
    this.tripId = newTripId();
    this.pings = [];

    const trip = {
      id: this.tripId,
      user_id: userId,
      name: tripName || null,
      started_at: new Date().toISOString(),
      ended_at: null,
      ping_interval_ms: this.settings.pingIntervalMs,
      ping_timeout_ms: this.settings.pingTimeoutMs,
    };
    await outboxAdd({ outboxId: `${Date.now()}_trip_${this.tripId}`, table: 'trips', payload: trip });

    this._startGeoWatch();
    await this._requestWakeLock();

    this._sendPing(); // premier ping immédiat, pas d'attente de 15s
    this.intervalId = setInterval(() => this._sendPing(), this.settings.pingIntervalMs);

    this.syncIntervalId = setInterval(() => this.syncOutbox(), SYNC_INTERVAL_MS);
    window.addEventListener('online', this._onlineHandler);
    this.syncOutbox();

    return this.tripId;
  }

  async stop() {
    clearInterval(this.intervalId);
    clearInterval(this.syncIntervalId);
    window.removeEventListener('online', this._onlineHandler);
    this._stopGeoWatch();
    await this._releaseWakeLock();

    await outboxAdd({
      outboxId: `${Date.now()}_tripend_${this.tripId}`,
      table: 'trips',
      payload: { id: this.tripId, ended_at: new Date().toISOString() },
    });
    await this.syncOutbox();

    return this.tripId;
  }

  _startGeoWatch() {
    if (!('geolocation' in navigator)) {
      this.onStatus({ type: 'error', message: 'Géolocalisation indisponible sur cet appareil.' });
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.currentPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      },
      (err) => this.onStatus({ type: 'geo-error', message: err.message }),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  _stopGeoWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      this.onStatus({
        type: 'warning',
        message: "Wake Lock non supporté par ce navigateur : pense à empêcher l'écran de s'éteindre manuellement.",
      });
      return;
    }
    try {
      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockSentinel = null;
      });
      document.addEventListener('visibilitychange', this._reacquireWakeLock);
    } catch (err) {
      this.onStatus({ type: 'warning', message: `Wake Lock refusé : ${err.message}` });
    }
  }

  _reacquireWakeLock = async () => {
    if (document.visibilityState === 'visible' && this.intervalId) {
      await this._requestWakeLock();
    }
  };

  async _releaseWakeLock() {
    document.removeEventListener('visibilitychange', this._reacquireWakeLock);
    if (this.wakeLockSentinel) {
      await this.wakeLockSentinel.release();
      this.wakeLockSentinel = null;
    }
  }

  async _sendPing() {
    const sentAt = new Date().toISOString();
    const startPos = this.currentPosition;

    const { elapsedMs, success } = await pingOnce(this.settings.pingTimeoutMs);

    const resolvedAt = new Date().toISOString();
    const endPos = this.currentPosition;

    const record = {
      id: newPingId(),
      tripId: this.tripId,
      sentAt,
      resolvedAt,
      startLat: startPos?.lat ?? null,
      startLng: startPos?.lng ?? null,
      startAccuracy: startPos?.accuracy ?? null,
      endLat: endPos?.lat ?? null,
      endLng: endPos?.lng ?? null,
      endAccuracy: endPos?.accuracy ?? null,
      elapsedMs,
      success,
    };

    this.pings.push(record);
    this.onPing(record, this.pings);

    await outboxAdd({
      outboxId: `${Date.now()}_ping_${record.id}`,
      table: 'pings',
      payload: toRow(record),
    });
    this.syncOutbox();
  }

  async syncOutbox() {
    const entries = await outboxGetAll();
    if (entries.length === 0) return;

    const ordered = [
      ...entries.filter((e) => e.table === 'trips').sort((a, b) => (a.outboxId < b.outboxId ? -1 : 1)),
      ...entries.filter((e) => e.table === 'pings').sort((a, b) => (a.outboxId < b.outboxId ? -1 : 1)),
    ];

    for (const entry of ordered) {
      const { error } = await supabase.from(entry.table).upsert(entry.payload, { onConflict: 'id' });
      if (error) {
        this.onStatus({ type: 'sync-pending', message: `Synchro en attente (${entry.table})` });
        continue; // on retentera au prochain cycle, on ne bloque pas les autres tables
      }
      await outboxRemove(entry.outboxId);
    }
  }
}

function toRow(record) {
  return {
    id: record.id,
    trip_id: record.tripId,
    sent_at: record.sentAt,
    resolved_at: record.resolvedAt,
    start_lat: record.startLat,
    start_lng: record.startLng,
    start_accuracy: record.startAccuracy,
    end_lat: record.endLat,
    end_lng: record.endLng,
    end_accuracy: record.endAccuracy,
    elapsed_ms: record.elapsedMs,
    success: record.success,
  };
}
