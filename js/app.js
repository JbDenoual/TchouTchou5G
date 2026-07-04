import { signIn, signUp, signOut, getCurrentUser, onAuthStateChange } from './auth.js';
import { getSettings, saveSettings } from './settings.js';
import { listTrips, getTripPings, getTrip, deleteTrip } from './trips.js';
import { Recorder } from './recorder.js';
import { MapView } from './mapView.js';
import { tripSummary } from './quality.js';

let settings = getSettings();
let recorder = null;
let reviewMapView = null;
let currentUser = null;
let currentTripId = null;

const screens = ['screen-auth', 'screen-home', 'screen-review', 'screen-settings'];

function showScreen(id) {
  screens.forEach((s) => document.getElementById(s).classList.toggle('active', s === id));
  const tabs = document.getElementById('mainTabs');
  tabs.style.display = id === 'screen-home' || id === 'screen-settings' ? 'flex' : 'none';
  document.getElementById('tabHome').classList.toggle('active', id === 'screen-home');
  document.getElementById('tabSettings').classList.toggle('active', id === 'screen-settings');
}

// ---------- Routage (permet d'utiliser le bouton retour du navigateur) ----------

function route() {
  if (!currentUser) {
    showScreen('screen-auth');
    return;
  }

  const hash = location.hash || '#home';

  if (hash === '#settings') {
    loadSettingsIntoForm();
    showScreen('screen-settings');
  } else if (hash.startsWith('#review/')) {
    showScreen('screen-review');
    loadTripDetail(hash.slice('#review/'.length));
  } else {
    showScreen('screen-home');
    refreshTripList();
  }
}

function navigate(hash, { replace = false } = {}) {
  if (replace) {
    history.replaceState(null, '', hash);
  } else if (location.hash !== hash) {
    history.pushState(null, '', hash);
  }
  route();
}

window.addEventListener('popstate', () => {
  // Empêche de quitter accidentellement un enregistrement en cours avec le bouton retour.
  if (recorder && location.hash !== `#review/${recorder.tripId}`) {
    history.pushState(null, '', `#review/${recorder.tripId}`);
    document.getElementById('reviewSummary').textContent = "Arrête l'enregistrement avant de changer d'écran.";
    return;
  }
  route();
});

// ---------- Auth ----------

document.getElementById('btnSignIn').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errBox = document.getElementById('authError');
  errBox.textContent = '';
  try {
    await signIn(email, password);
  } catch (err) {
    errBox.textContent = err.message;
  }
});

document.getElementById('btnSignUp').addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errBox = document.getElementById('authError');
  errBox.textContent = '';
  try {
    await signUp(email, password);
    errBox.textContent = 'Compte créé. Si la confirmation par email est activée, vérifie ta boîte mail avant de te connecter.';
    errBox.style.color = 'var(--text-secondary)';
  } catch (err) {
    errBox.textContent = err.message;
    errBox.style.color = '';
  }
});

document.getElementById('btnSignOut').addEventListener('click', async () => {
  await signOut();
});

onAuthStateChange((user) => {
  currentUser = user;
  if (user) {
    document.getElementById('userBadge').textContent = user.email;
    if (!location.hash || location.hash === '#auth') {
      navigate('#home', { replace: true });
    } else {
      route();
    }
  } else {
    document.getElementById('userBadge').textContent = '';
    navigate('#auth', { replace: true });
  }
});

// ---------- Navigation ----------

document.getElementById('tabHome').addEventListener('click', () => navigate('#home'));
document.getElementById('tabSettings').addEventListener('click', () => navigate('#settings'));

// ---------- Accueil / liste des trajets ----------

const TRASH_ICON = `<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z"/></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" class="icon" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" class="icon" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

async function refreshTripList() {
  const listEl = document.getElementById('tripList');
  listEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const trips = await listTrips();
    if (trips.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Aucun trajet enregistré pour le moment.</div>';
      return;
    }
    listEl.innerHTML = '';
    trips.forEach((trip) => listEl.appendChild(buildTripRow(trip)));
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Erreur de chargement : ${err.message}</div>`;
  }
}

function buildTripRow(trip) {
  const row = document.createElement('div');
  row.className = 'trip-row';
  const date = new Date(trip.started_at).toLocaleString('fr-FR');

  row.innerHTML = `
    <div class="trip-row__main">
      <div class="trip-row__name">${escapeHtml(trip.name || 'Trajet sans nom')}</div>
      <div class="trip-row__meta">${date}</div>
    </div>
    <div class="trip-row__action"></div>
  `;

  row.addEventListener('click', () => navigate(`#review/${trip.id}`));
  renderDeleteIcon(row, trip);

  return row;
}

function renderDeleteIcon(row, trip) {
  const action = row.querySelector('.trip-row__action');
  action.innerHTML = `<button type="button" class="btn-icon" aria-label="Supprimer ce trajet">${TRASH_ICON}</button>`;
  action.querySelector('button').addEventListener('click', (e) => {
    e.stopPropagation();
    renderDeleteConfirm(row, trip);
  });
}

function renderDeleteConfirm(row, trip) {
  const action = row.querySelector('.trip-row__action');
  action.innerHTML = `
    <div class="trip-row__confirm">
      <button type="button" class="btn btn-ghost" data-role="cancel">Annuler</button>
      <button type="button" class="btn btn-danger" data-role="confirm">Supprimer</button>
    </div>
  `;

  action.querySelector('[data-role="cancel"]').addEventListener('click', (e) => {
    e.stopPropagation();
    renderDeleteIcon(row, trip);
  });

  action.querySelector('[data-role="confirm"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    action.innerHTML = '<span class="trip-row__meta">Suppression…</span>';
    try {
      await deleteTrip(trip.id);
      refreshTripList();
    } catch (err) {
      action.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Liste des pings (carte + journal détaillé) ----------

function formatPingPosition(ping) {
  const lat = ping.endLat ?? ping.startLat;
  const lng = ping.endLng ?? ping.startLng;
  if (lat == null || lng == null) return 'Aucune position captée';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function buildPingRow(ping) {
  const row = document.createElement('div');
  row.className = 'ping-row';
  const time = new Date(ping.sentAt).toLocaleTimeString('fr-FR');
  const latencyClass = ping.success ? 'ping-row__latency--ok' : 'ping-row__latency--fail';
  const latencyText = ping.success ? `${ping.elapsedMs} ms` : 'Échec';

  row.innerHTML = `
    <span class="ping-row__time">${time}</span>
    <span class="ping-row__pos">${escapeHtml(formatPingPosition(ping))}</span>
    <span class="ping-row__latency ${latencyClass}">${latencyText}</span>
  `;
  return row;
}

function renderPingList(container, pings) {
  if (pings.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucun ping pour le moment.</div>';
    return;
  }
  container.innerHTML = '';
  pings.forEach((ping) => container.appendChild(buildPingRow(ping)));
}

// ---------- Détail d'un trajet (carte + contrôle de l'enregistrement) ----------

function describeGeoError(err) {
  if (!err) return null;
  switch (err.code) {
    case 1:
      return "accès à la position refusé — autorise la géolocalisation dans les réglages du navigateur";
    case 2:
      return 'position indisponible pour le moment';
    case 3:
      return 'délai dépassé pour obtenir la position';
    default:
      return err.message || 'géolocalisation indisponible';
  }
}

function updateGpsStatus(position, err) {
  const el = document.getElementById('gpsStatus');
  if (position) {
    el.textContent = `Position GPS : ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} (± ${Math.round(position.accuracy)} m)`;
    el.classList.remove('status-bar--warning');
    return;
  }
  const reason = describeGeoError(err);
  el.textContent = reason
    ? `Aucune position GPS captée — ${reason}`
    : 'Aucune position GPS captée pour le moment…';
  el.classList.add('status-bar--warning');
}

function updateLiveSummary(allPings, lastPing) {
  const okCount = allPings.filter((p) => p.success).length;
  const lastText = lastPing ? ` — dernier : ${lastPing.success ? lastPing.elapsedMs + ' ms' : 'échec'}` : '';
  document.getElementById('reviewSummary').textContent =
    `${allPings.length} pings — ${okCount}/${allPings.length} réussis${lastText}`;
}

function updateStaticSummary(pings) {
  const summary = tripSummary(pings, settings);
  document.getElementById('reviewSummary').textContent =
    `${pings.length} pings — 🟢 ${summary.percentages.green}% · 🟡 ${summary.percentages.yellow}% · 🟠 ${summary.percentages.orange}% · 🔴 ${summary.percentages.red}%`;
}

function buildRecordCallbacks(pingListEl) {
  return {
    onPing: (ping, allPings) => {
      reviewMapView.render(allPings, settings);
      reviewMapView.panTo(ping);
      updateLiveSummary(allPings, ping);
      renderPingList(pingListEl, allPings);
      pingListEl.scrollTop = pingListEl.scrollHeight;
    },
    onStatus: (status) => {
      if (status.type === 'error' || status.type === 'warning') {
        document.getElementById('reviewSummary').textContent = status.message;
      }
    },
    onPosition: (position, err) => updateGpsStatus(position, err),
  };
}

// Bascule l'apparence de l'écran selon qu'un enregistrement est actif pour
// le trajet affiché : bouton, position GPS et suppression (désactivée tant
// que le trajet est en cours d'enregistrement).
function setLiveState(isLive) {
  const btn = document.getElementById('btnToggleRecording');
  if (isLive) {
    btn.innerHTML = `${STOP_ICON} Arrêter l'enregistrement`;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
  } else {
    btn.innerHTML = `${PLAY_ICON} Démarrer l'enregistrement`;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
  }
  document.getElementById('gpsStatus').style.display = isLive ? '' : 'none';
  document.getElementById('reviewDeleteSlot').style.display = isLive ? 'none' : '';
}

async function loadTripDetail(tripId) {
  currentTripId = tripId;
  if (!reviewMapView) reviewMapView = new MapView('mapReview');
  reviewMapView.clear();
  reviewMapView.invalidate(); // l'écran était caché (display:none) jusqu'ici
  renderReviewDeleteIcon();

  const pingListEl = document.getElementById('pingListReview');
  const isLive = recorder && recorder.tripId === tripId;
  setLiveState(isLive);

  if (isLive) {
    reviewMapView.render(recorder.pings, settings);
    renderPingList(pingListEl, recorder.pings);
    pingListEl.scrollTop = pingListEl.scrollHeight;
    updateLiveSummary(recorder.pings);
    return;
  }

  document.getElementById('reviewSummary').textContent = 'Chargement…';
  pingListEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    const pings = await getTripPings(tripId);
    reviewMapView.render(pings, settings);
    renderPingList(pingListEl, pings);
    updateStaticSummary(pings);
  } catch (err) {
    document.getElementById('reviewSummary').textContent = `Erreur : ${err.message}`;
    pingListEl.innerHTML = '';
  }
}

document.getElementById('btnStartTrip').addEventListener('click', async () => {
  if (!currentUser) return;
  const name = document.getElementById('tripNameInput').value.trim();

  recorder = new Recorder({ settings, ...buildRecordCallbacks(document.getElementById('pingListReview')) });
  await recorder.start(currentUser.id, name);

  navigate(`#review/${recorder.tripId}`);
});

document.getElementById('btnToggleRecording').addEventListener('click', async () => {
  const btn = document.getElementById('btnToggleRecording');

  if (recorder && recorder.tripId === currentTripId) {
    // Arrêter : on suspend le suivi mais on reste sur cette page, le trajet
    // reste consultable et reprenable plus tard.
    btn.disabled = true;
    document.getElementById('reviewSummary').textContent = 'Synchronisation…';
    await recorder.stop();
    recorder = null;
    btn.disabled = false;
    setLiveState(false);

    const pings = await getTripPings(currentTripId).catch(() => []);
    reviewMapView.render(pings, settings);
    renderPingList(document.getElementById('pingListReview'), pings);
    updateStaticSummary(pings);
    return;
  }

  // Démarrer / reprendre ce trajet précis.
  btn.disabled = true;
  document.getElementById('reviewSummary').textContent = 'Chargement…';
  let trip;
  let existingPings;
  try {
    [trip, existingPings] = await Promise.all([getTrip(currentTripId), getTripPings(currentTripId)]);
  } catch (err) {
    document.getElementById('reviewSummary').textContent = `Erreur : ${err.message}`;
    btn.disabled = false;
    return;
  }

  recorder = new Recorder({
    settings: { ...settings, pingIntervalMs: trip.ping_interval_ms, pingTimeoutMs: trip.ping_timeout_ms },
    ...buildRecordCallbacks(document.getElementById('pingListReview')),
  });

  setLiveState(true);
  updateGpsStatus(null, null);
  reviewMapView.render(existingPings, settings);
  renderPingList(document.getElementById('pingListReview'), existingPings);

  btn.disabled = false;
  await recorder.resumeExisting(currentTripId, existingPings);
});

document.getElementById('btnBackFromReview').addEventListener('click', () => {
  history.back();
});

function renderReviewDeleteIcon() {
  const slot = document.getElementById('reviewDeleteSlot');
  slot.innerHTML = `<button type="button" class="btn-icon" aria-label="Supprimer ce trajet">${TRASH_ICON}</button>`;
  slot.querySelector('button').addEventListener('click', renderReviewDeleteConfirm);
}

function renderReviewDeleteConfirm() {
  const slot = document.getElementById('reviewDeleteSlot');
  slot.innerHTML = `
    <div class="trip-row__confirm">
      <button type="button" class="btn btn-ghost" data-role="cancel">Annuler</button>
      <button type="button" class="btn btn-danger" data-role="confirm">Supprimer</button>
    </div>
  `;

  slot.querySelector('[data-role="cancel"]').addEventListener('click', renderReviewDeleteIcon);

  slot.querySelector('[data-role="confirm"]').addEventListener('click', async () => {
    slot.innerHTML = '<span class="trip-row__meta">Suppression…</span>';
    try {
      await deleteTrip(currentTripId);
      navigate('#home', { replace: true });
    } catch (err) {
      slot.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
    }
  });
}

// ---------- Réglages ----------

function loadSettingsIntoForm() {
  document.getElementById('setInterval').value = settings.pingIntervalMs / 1000;
  document.getElementById('setTimeout').value = settings.pingTimeoutMs / 1000;
  document.getElementById('setWindow').value = settings.rollingWindowSize;
  document.getElementById('setRed').value = Math.round(settings.thresholds.redMaxSuccessRate * 100);
  document.getElementById('setOrange').value = Math.round(settings.thresholds.orangeMaxSuccessRate * 100);
  document.getElementById('setYellow').value = settings.thresholds.yellowMinLatencyMs;
}

document.getElementById('btnSaveSettings').addEventListener('click', () => {
  settings = {
    pingIntervalMs: Number(document.getElementById('setInterval').value) * 1000,
    pingTimeoutMs: Number(document.getElementById('setTimeout').value) * 1000,
    rollingWindowSize: Number(document.getElementById('setWindow').value),
    thresholds: {
      redMaxSuccessRate: Number(document.getElementById('setRed').value) / 100,
      orangeMaxSuccessRate: Number(document.getElementById('setOrange').value) / 100,
      yellowMinLatencyMs: Number(document.getElementById('setYellow').value),
    },
  };
  saveSettings(settings);
  navigate('#home', { replace: true });
});

// ---------- Démarrage de l'app ----------

(async function init() {
  loadSettingsIntoForm();
  currentUser = await getCurrentUser();
  if (currentUser) {
    document.getElementById('userBadge').textContent = currentUser.email;
    if (!location.hash) {
      navigate('#home', { replace: true });
    } else {
      route();
    }
  } else {
    navigate('#auth', { replace: true });
  }
})();
