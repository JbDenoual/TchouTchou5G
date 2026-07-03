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
    showScreen('screen-home');
    refreshTripList();
  } else {
    document.getElementById('userBadge').textContent = '';
    showScreen('screen-auth');
  }
});

// ---------- Navigation ----------

document.getElementById('tabHome').addEventListener('click', () => {
  showScreen('screen-home');
  refreshTripList();
});
document.getElementById('tabSettings').addEventListener('click', () => {
  loadSettingsIntoForm();
  showScreen('screen-settings');
});

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

  row.addEventListener('click', () => openReview(trip));
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

// ---------- Démarrage / arrêt d'un enregistrement ----------

document.getElementById('btnStartTrip').addEventListener('click', async () => {
  if (!currentUser) return;
  const name = document.getElementById('tripNameInput').value.trim();

  showScreen('screen-record');
  if (!recordMapView) recordMapView = new MapView('map');
  recordMapView.clear();
  document.getElementById('recordStatus').textContent = 'Acquisition GPS…';

  recorder = new Recorder({
    settings,
    onPing: (ping, allPings) => {
      recordMapView.render(allPings, settings);
      recordMapView.panTo(ping);
      const okCount = allPings.filter((p) => p.success).length;
      document.getElementById('recordStatus').textContent =
        `${allPings.length} pings — ${okCount}/${allPings.length} réussis — dernier : ${ping.success ? ping.elapsedMs + ' ms' : 'échec'}`;
    },
    onStatus: (status) => {
      if (status.type === 'error' || status.type === 'warning') {
        document.getElementById('recordStatus').textContent = status.message;
      }
    },
  });

  await recorder.start(currentUser.id, name);
});

document.getElementById('btnStopTrip').addEventListener('click', async () => {
  if (!recorder) return;
  document.getElementById('recordStatus').textContent = 'Synchronisation…';
  await recorder.stop();
  recorder = null;
  showScreen('screen-home');
  refreshTripList();
});

// ---------- Revue d'un trajet ----------

async function openReview(trip) {
  currentReviewTripId = trip.id;
  resetDeleteFromReviewButton();
  showScreen('screen-review');
  document.getElementById('reviewSummary').textContent = 'Chargement…';
  if (!reviewMapView) reviewMapView = new MapView('mapReview');
  reviewMapView.clear();

  try {
    const pings = await getTripPings(trip.id);
    reviewMapView.render(pings, settings);
    const summary = tripSummary(pings, settings);
    document.getElementById('reviewSummary').textContent =
      `${pings.length} pings — 🟢 ${summary.percentages.green}% · 🟡 ${summary.percentages.yellow}% · 🟠 ${summary.percentages.orange}% · 🔴 ${summary.percentages.red}%`;
  } catch (err) {
    document.getElementById('reviewSummary').textContent = `Erreur : ${err.message}`;
  }
}

document.getElementById('btnBackFromReview').addEventListener('click', () => {
  showScreen('screen-home');
  refreshTripList();
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
    showScreen('screen-home');
    refreshTripList();
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
  showScreen('screen-home');
  refreshTripList();
});

// ---------- Démarrage de l'app ----------

(async function init() {
  loadSettingsIntoForm();
  currentUser = await getCurrentUser();
  if (currentUser) {
    document.getElementById('userBadge').textContent = currentUser.email;
    showScreen('screen-home');
    refreshTripList();
  } else {
    showScreen('screen-auth');
  }
})();
