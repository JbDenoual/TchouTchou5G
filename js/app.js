import { signIn, signUp, signOut, getCurrentUser, onAuthStateChange } from './auth.js';
import { getSettings, saveSettings } from './settings.js';
import { listTrips, getTripPings, newTripId } from './trips.js';
import { Recorder } from './recorder.js';
import { MapView } from './mapView.js';
import { tripSummary } from './quality.js';

let settings = getSettings();
let recorder = null;
let recordMapView = null;
let reviewMapView = null;
let currentUser = null;

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
    errBox.style.color = 'var(--muted)';
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

async function refreshTripList() {
  const listEl = document.getElementById('tripList');
  listEl.textContent = 'Chargement…';
  try {
    const trips = await listTrips();
    if (trips.length === 0) {
      listEl.textContent = 'Aucun trajet enregistré pour le moment.';
      return;
    }
    listEl.innerHTML = '';
    trips.forEach((trip) => {
      const div = document.createElement('div');
      div.className = 'trip-item';
      const date = new Date(trip.started_at).toLocaleString('fr-FR');
      div.innerHTML = `<span>${trip.name || 'Trajet sans nom'}<br><small style="color:var(--muted)">${date}</small></span>`;
      div.addEventListener('click', () => openReview(trip));
      listEl.appendChild(div);
    });
  } catch (err) {
    listEl.textContent = `Erreur de chargement : ${err.message}`;
  }
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
