"use strict";

const DB_NAME = "consuntivo";
const DB_VERSION = 1;
const STORE_NAME = "activities";
const ITALIAN_MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

const form = document.querySelector("#activity-form");
const dateInput = document.querySelector("#activity-date");
const clientInput = document.querySelector("#client");
const clientSuggestions = document.querySelector("#client-suggestions");
const hoursInput = document.querySelector("#hours");
const minutesInput = document.querySelector("#minutes");
const descriptionInput = document.querySelector("#description");
const monthLabel = document.querySelector("#month-label");
const monthTotal = document.querySelector("#month-total");
const entryCount = document.querySelector("#entry-count");
const clientTotals = document.querySelector("#client-totals");
const entriesElement = document.querySelector("#entries");
const formMessage = document.querySelector("#form-message");

let database;
let selectedMonth = new Date();
selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("date", "date", { unique: false });
      store.createIndex("client", "client", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dateInputValue(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function runTransaction(mode, operation) {
  const transaction = database.transaction(STORE_NAME, mode);
  const request = operation(transaction.objectStore(STORE_NAME));

  return new Promise((resolve, reject) => {
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Errore nella richiesta al database."));
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("La transazione al database è stata annullata."));
    };
  });
}

function addActivity(activity) {
  return runTransaction("readwrite", (store) => store.add(activity));
}

function deleteActivity(id) {
  return runTransaction("readwrite", (store) => store.delete(id));
}

function getActivities() {
  return runTransaction("readonly", (store) => store.getAll());
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${minutes} min`;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("it-IT").format(new Date(year, month - 1, day));
}

function showMessage(message, isError = false) {
  formMessage.textContent = message;
  formMessage.dataset.error = String(isError);
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  parent.append(element);
  return element;
}

async function refreshReport() {
  const year = selectedMonth.getFullYear();
  const month = String(selectedMonth.getMonth() + 1).padStart(2, "0");
  const monthKey = `${year}-${month}`;
  monthLabel.textContent = `${ITALIAN_MONTHS[selectedMonth.getMonth()]} ${year}`;

  const allActivities = await getActivities();
  const activities = allActivities
    .filter((activity) => activity.date.startsWith(`${monthKey}-`))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id - left.id);
  const totalsByClient = new Map();
  let totalMinutes = 0;

  for (const activity of activities) {
    totalMinutes += activity.durationMinutes;
    const key = activity.client.trim().toLocaleLowerCase("it-IT");
    const current = totalsByClient.get(key);
    if (current) current.minutes += activity.durationMinutes;
    else totalsByClient.set(key, { name: activity.client, minutes: activity.durationMinutes });
  }

  monthTotal.textContent = `Totale: ${formatDuration(totalMinutes)}`;
  entryCount.textContent = activities.length
    ? `${activities.length} ${activities.length === 1 ? "attività registrata" : "attività registrate"}`
    : "Nessuna attività registrata.";

  clientTotals.replaceChildren();
  entriesElement.replaceChildren();
  if (!activities.length) return;

  addText(clientTotals, "h3", "", "Totale per commessa");
  const sortedClients = [...totalsByClient.values()].sort(
    (left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name, "it"),
  );
  for (const client of sortedClients) {
    const row = document.createElement("div");
    row.className = "client-total";
    addText(row, "span", "", client.name);
    addText(row, "strong", "", formatDuration(client.minutes));
    clientTotals.append(row);
  }

  addText(entriesElement, "h3", "", "Attività registrate");
  for (const activity of activities) {
    const row = document.createElement("article");
    row.className = "entry-row";

    const heading = document.createElement("div");
    heading.className = "entry-heading";
    addText(heading, "span", "", `${formatDate(activity.date)} · ${activity.client}`);
    addText(heading, "span", "entry-duration", formatDuration(activity.durationMinutes));
    row.append(heading);

    if (activity.description) {
      addText(row, "p", "entry-description", activity.description);
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Elimina";
    deleteButton.setAttribute("aria-label", `Elimina attività del ${formatDate(activity.date)} per ${activity.client}`);
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Eliminare l'attività del ${formatDate(activity.date)} per ${activity.client}?`)) {
        return;
      }
      try {
        await deleteActivity(activity.id);
        await refreshReport();
        await refreshClientSuggestions();
      } catch (error) {
        showMessage(`Impossibile eliminare l'attività: ${error.message}`, true);
      }
    });
    row.append(deleteButton);
    entriesElement.append(row);
  }
}

async function refreshClientSuggestions() {
  const activities = await getActivities();
  const uniqueClients = new Map();
  for (const activity of activities) {
    const key = activity.client.trim().toLocaleLowerCase("it-IT");
    if (!uniqueClients.has(key)) uniqueClients.set(key, activity.client);
  }

  clientSuggestions.replaceChildren();
  for (const client of [...uniqueClients.values()].sort((a, b) => a.localeCompare(b, "it"))) {
    const option = document.createElement("option");
    option.value = client;
    clientSuggestions.append(option);
  }
}

function shiftMonth(offset) {
  selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + offset, 1);
  refreshReport().catch((error) => showMessage(`Errore nel riepilogo: ${error.message}`, true));
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const client = clientInput.value.trim();
  const hoursText = hoursInput.value.trim();
  const minutesText = minutesInput.value.trim();
  const hours = hoursText === "" ? 0 : Number(hoursText);
  const minutes = minutesText === "" ? 0 : Number(minutesText);

  if (!client) {
    showMessage("Inserisci il cliente o la commessa.", true);
    clientInput.focus();
    return;
  }
  if (!dateInput.value) {
    showMessage("Inserisci una data valida.", true);
    dateInput.focus();
    return;
  }
  if ((!hoursText && !minutesText) || !Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes)) {
    showMessage("Inserisci una durata valida in ore e/o minuti.", true);
    hoursInput.focus();
    return;
  }
  if (hours < 0 || minutes < 0 || minutes > 59) {
    showMessage("Le ore non possono essere negative e i minuti devono essere tra 0 e 59.", true);
    minutesInput.focus();
    return;
  }
  const durationMinutes = hours * 60 + minutes;
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
    showMessage("La durata deve essere maggiore di zero.", true);
    return;
  }

  try {
    await addActivity({
      date: dateInput.value,
      client,
      description: descriptionInput.value.trim(),
      durationMinutes,
    });
    form.reset();
    dateInput.value = dateInputValue();
    selectedMonth = new Date(`${dateInput.value}T12:00:00`);
    selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    await refreshReport();
    await refreshClientSuggestions();
    showMessage("Attività salvata.");
  } catch (error) {
    showMessage(`Impossibile salvare l'attività: ${error.message}`, true);
  }
});

document.querySelector("#previous-month").addEventListener("click", () => shiftMonth(-1));
document.querySelector("#next-month").addEventListener("click", () => shiftMonth(1));

async function startApp() {
  if (!("indexedDB" in window)) {
    throw new Error("Questo browser non supporta l'archiviazione locale necessaria.");
  }
  database = await openDatabase();
  dateInput.value = dateInputValue();
  await refreshReport();
  await refreshClientSuggestions();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      showMessage(`App avviata, ma non è stato possibile attivare la modalità offline: ${error.message}`, true);
    });
  }
}

startApp().catch((error) => {
  showMessage(`Impossibile avviare l'app: ${error.message}`, true);
});
