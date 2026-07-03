import { signIn, signUp, signOut, getCurrentUser, onAuthStateChange } from './auth.js';
import { getSettings, saveSettings } from './settings.js';
import { listTrips, getTripPings, deleteTrip } from './trips.js';
import { Recorder } from './recorder.js';
import { MapView } from './mapView.js';
import { tripSummary } from './quality.js';

let settings = getSettings();
let recorder = null;
let recordMapView = null;
let reviewMapView = null;
let currentUser = null;
let currentReviewTripId = null;

const screens = ['screen-auth', 'screen-home', 'screen-record', 'screen-review', 'screen-settings'];

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
  } else if (hash === '#record') {
    if (!recorder) {
      navigate('#home', { replace: true }); // pas d'enregistrement en cours, rien à afficher ici
      return;
    }
    showScreen('screen-record');
  } else if (hash.startsWith('#review/')) {
    showScreen('screen-review');
    loadReview(hash.slice('#review/'.length));
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
  if (recorder && location.hash !== '#record') {
    history.pushState(null, '', '#record');
    document.getElementById('recordStatus').textContent = "Arrête l'enregistrement avant de changer d'écran.";
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

// ---------- Démarrage / arrêt d'un enregistrement ----------

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

const btnPauseTrip = document.getElementById('btnPauseTrip');
const PAUSE_ICON = `<svg viewBox="0 0 24 24" class="icon" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`;
const RESUME_ICON = `<svg viewBox="0 0 24 24" class="icon" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

function setPauseButtonState(paused) {
  btnPauseTrip.innerHTML = paused ? `${RESUME_ICON} Reprendre` : `${PAUSE_ICON} Mettre en pause`;
}

btnPauseTrip.addEventListener('click', () => {
  if (!recorder) return;
  if (recorder.isPaused) {
    recorder.resume();
    setPauseButtonState(false);
    document.getElementById('recordStatus').textContent = "Reprise de l'enregistrement…";
  } else {
    recorder.pause();
    setPauseButtonState(true);
    document.getElementById('recordStatus').textContent = 'En pause — appuie sur Reprendre pour continuer.';
  }
});

document.getElementById('btnStartTrip').addEventListener('click', async () => {
  if (!currentUser) return;
  const name = document.getElementById('tripNameInput').value.trim();

  if (!recordMapView) recordMapView = new MapView('map');
  recordMapView.clear();
  setPauseButtonState(false);
  const pingListEl = document.getElementById('pingList');
  pingListEl.innerHTML = '';

  recorder = new Recorder({
    settings,
    onPing: (ping, allPings) => {
      recordMapView.render(allPings, settings);
      recordMapView.panTo(ping);
      const okCount = allPings.filter((p) => p.success).length;
      document.getElementById('recordStatus').textContent =
        `${allPings.length} pings — ${okCount}/${allPings.length} réussis — dernier : ${ping.success ? ping.elapsedMs + ' ms' : 'échec'}`;
      renderPingList(pingListEl, allPings);
      pingListEl.scrollTop = pingListEl.scrollHeight;
    },
    onStatus: (status) => {
      if (status.type === 'error' || status.type === 'warning') {
        document.getElementById('recordStatus').textContent = status.message;
      }
    },
    onPosition: (position, err) => updateGpsStatus(position, err),
  });

  navigate('#record');
  document.getElementById('recordStatus').textContent = 'Initialisation…';
  updateGpsStatus(null, null);

  await recorder.start(currentUser.id, name);
});

document.getElementById('btnStopTrip').addEventListener('click', async () => {
  if (!recorder) return;
  document.getElementById('recordStatus').textContent = 'Synchronisation…';
  await recorder.stop();
  recorder = null;
  navigate('#home', { replace: true });
});

// ---------- Revue d'un trajet ----------

async function loadReview(tripId) {
  currentReviewTripId = tripId;
  resetDeleteFromReviewButton();
  document.getElementById('reviewSummary').textContent = 'Chargement…';
  const pingListEl = document.getElementById('pingListReview');
  pingListEl.innerHTML = '<div class="empty-state">Chargement…</div>';
  if (!reviewMapView) reviewMapView = new MapView('mapReview');
  reviewMapView.clear();

  try {
    const pings = await getTripPings(tripId);
    reviewMapView.render(pings, settings);
    const summary = tripSummary(pings, settings);
    document.getElementById('reviewSummary').textContent =
      `${pings.length} pings — 🟢 ${summary.percentages.green}% · 🟡 ${summary.percentages.yellow}% · 🟠 ${summary.percentages.orange}% · 🔴 ${summary.percentages.red}%`;
    renderPingList(pingListEl, pings);
  } catch (err) {
    document.getElementById('reviewSummary').textContent = `Erreur : ${err.message}`;
    pingListEl.innerHTML = '';
  }
}

document.getElementById('btnBackFromReview').addEventListener('click', () => {
  history.back();
});

const btnDeleteFromReview = document.getElementById('btnDeleteFromReview');
const deleteFromReviewDefaultHtml = btnDeleteFromReview.innerHTML;

function resetDeleteFromReviewButton() {
  btnDeleteFromReview.innerHTML = deleteFromReviewDefaultHtml;
  btnDeleteFromReview.classList.remove('btn-danger');
  btnDeleteFromReview.classList.add('btn-danger-ghost');
  btnDeleteFromReview.dataset.armed = 'false';
}

btnDeleteFromReview.addEventListener('click', async () => {
  if (btnDeleteFromReview.dataset.armed !== 'true') {
    btnDeleteFromReview.dataset.armed = 'true';
    btnDeleteFromReview.textContent = 'Confirmer la suppression ?';
    btnDeleteFromReview.classList.remove('btn-danger-ghost');
    btnDeleteFromReview.classList.add('btn-danger');
    return;
  }
  btnDeleteFromReview.disabled = true;
  btnDeleteFromReview.textContent = 'Suppression…';
  try {
    await deleteTrip(currentReviewTripId);
    navigate('#home', { replace: true });
  } catch (err) {
    btnDeleteFromReview.disabled = false;
    btnDeleteFromReview.textContent = `Échec : ${err.message}`;
  }
});

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
