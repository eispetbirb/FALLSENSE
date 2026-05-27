(function initMedicationReminderModule() {
  let schedules = [];
  let patientNameById = {};
  let reminderCheckTimer = null;
  let alarmAudioContext = null;
  let alarmOscillator = null;
  let alarmGain = null;
  let activeReminder = null;
  let pageRefreshHandler = null;
  let refreshHookInstalled = false;

  const dismissedReminders = new Set();
  const snoozeUntilById = {};
  const dueReminderQueue = [];
  const REMINDER_CHECK_MS = 30000;
  const SNOOZE_MS = 5 * 60 * 1000;
  const REMINDER_WINDOW_MS = 30 * 60 * 1000;

  function toDateStr(date) {
    return (
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function hasCaregiverSession() {
    return (
      localStorage.getItem("auth_token") &&
      localStorage.getItem("user_role") === "caregiver"
    );
  }

  function toast(message, variant = "info") {
    window.CaregiverAPI?.showToast?.(message, variant);
  }

  function ensureModalMarkup() {
    if (document.getElementById("medAlarmModal")) return;

    document.body.insertAdjacentHTML(
      "beforeend",
      `
      <div
        class="med-alarm-overlay"
        id="medAlarmModal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="medAlarmTitle"
        aria-describedby="medAlarmDesc"
      >
        <div class="med-alarm-box">
          <div class="med-alarm-pulse" aria-hidden="true"></div>
          <div class="med-alarm-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M19 9h-2V7a7 7 0 10-14 0v2H1v13h18V9z"/>
              <line x1="10" y1="13" x2="10" y2="17"/>
              <line x1="8" y1="15" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="med-alarm-eyebrow">Medication reminder</div>
          <h2 class="med-alarm-title" id="medAlarmTitle">Time to take medicine</h2>
          <p class="med-alarm-desc" id="medAlarmDesc">A scheduled dose is due now.</p>
          <div class="med-alarm-details" id="medAlarmDetails"></div>
          <div class="med-alarm-actions">
            <button type="button" class="btn-alarm btn-alarm-taken" id="medAlarmTaken">Mark Taken</button>
            <button type="button" class="btn-alarm btn-alarm-missed" id="medAlarmMissed">Mark Missed</button>
            <button type="button" class="btn-alarm btn-alarm-snooze" id="medAlarmSnooze">Snooze 5 min</button>
          </div>
        </div>
      </div>
    `,
    );
  }

  function parseScheduleTimeToDate(timeStr, referenceDate = new Date()) {
    if (!timeStr) return null;
    const trimmed = String(timeStr).trim();

    const twentyFourHour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHour) {
      const parsed = new Date(referenceDate);
      parsed.setHours(+twentyFourHour[1], +twentyFourHour[2], 0, 0);
      return parsed;
    }

    const twelveHour = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (twelveHour) {
      let hour = +twelveHour[1];
      const minute = +twelveHour[2];
      const meridiem = twelveHour[3].toUpperCase();
      if (meridiem === "PM" && hour !== 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      const parsed = new Date(referenceDate);
      parsed.setHours(hour, minute, 0, 0);
      return parsed;
    }

    return null;
  }

  function reminderStorageKey(scheduleId, dateStr) {
    return `${scheduleId}:${dateStr}`;
  }

  function loadDismissedReminders() {
    const todayStr = toDateStr(new Date());
    try {
      const raw = sessionStorage.getItem("fallsenseMedReminders");
      const parsed = raw ? JSON.parse(raw) : [];
      parsed.forEach((key) => {
        if (String(key).endsWith(`:${todayStr}`)) dismissedReminders.add(key);
      });
    } catch (error) {
      console.warn("Unable to restore medication reminders", error);
    }
  }

  function persistDismissedReminder(scheduleId) {
    const key = reminderStorageKey(scheduleId, toDateStr(new Date()));
    dismissedReminders.add(key);
    try {
      sessionStorage.setItem(
        "fallsenseMedReminders",
        JSON.stringify([...dismissedReminders]),
      );
    } catch (error) {
      console.warn("Unable to persist medication reminder dismissal", error);
    }
  }

  function resolvePatientLabel(patientId) {
    const id = String(patientId || "").trim();
    if (!id) return "Unknown patient";
    return patientNameById[id] || id;
  }

  function isMedicationDue(schedule, now = new Date()) {
    if (String(schedule?.status || "").toLowerCase() !== "pending") return false;

    const snoozedUntil = snoozeUntilById[schedule.id];
    if (snoozedUntil && now.getTime() < snoozedUntil) return false;

    const reminderKey = reminderStorageKey(schedule.id, toDateStr(now));
    if (dismissedReminders.has(reminderKey)) return false;

    const scheduledAt = parseScheduleTimeToDate(schedule.schedule_time, now);
    if (!scheduledAt) return false;

    const diffMs = now.getTime() - scheduledAt.getTime();
    return diffMs >= 0 && diffMs <= REMINDER_WINDOW_MS;
  }

  function getDueMedications(now = new Date()) {
    return schedules.filter((schedule) => isMedicationDue(schedule, now));
  }

  async function loadPatients() {
    const payload = await window.CaregiverAPI.apiJson("/api/patients/status");
    const patients = Array.isArray(payload) ? payload : [];
    patientNameById = patients.reduce((acc, item) => {
      const id = String(item?.patient_id || "").trim();
      const name = String(item?.patient_name || "").trim();
      if (id) acc[id] = name || id;
      return acc;
    }, {});
  }

  async function reloadSchedules() {
    const payload = await window.CaregiverAPI.apiJson("/api/medications");
    schedules = Array.isArray(payload) ? payload : [];
    return schedules;
  }

  function startAlarmSound() {
    try {
      if (!alarmAudioContext) {
        alarmAudioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
      }
      stopAlarmSound();
      alarmOscillator = alarmAudioContext.createOscillator();
      alarmGain = alarmAudioContext.createGain();
      alarmOscillator.type = "sine";
      alarmOscillator.frequency.setValueAtTime(
        880,
        alarmAudioContext.currentTime,
      );
      alarmGain.gain.setValueAtTime(0.0001, alarmAudioContext.currentTime);
      alarmOscillator.connect(alarmGain);
      alarmGain.connect(alarmAudioContext.destination);
      alarmOscillator.start();

      const pulse = () => {
        if (!alarmGain || !alarmAudioContext) return;
        const now = alarmAudioContext.currentTime;
        alarmGain.gain.cancelScheduledValues(now);
        alarmGain.gain.setValueAtTime(0.0001, now);
        alarmGain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
        alarmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      };

      pulse();
      window.medAlarmPulseTimer = window.setInterval(pulse, 900);
    } catch (error) {
      console.warn("Unable to play medication alarm sound", error);
    }
  }

  function stopAlarmSound() {
    if (window.medAlarmPulseTimer) {
      window.clearInterval(window.medAlarmPulseTimer);
      window.medAlarmPulseTimer = null;
    }
    if (alarmOscillator) {
      try {
        alarmOscillator.stop();
      } catch (error) {
        /* already stopped */
      }
      alarmOscillator.disconnect();
      alarmOscillator = null;
    }
    if (alarmGain) {
      alarmGain.disconnect();
      alarmGain = null;
    }
  }

  function renderAlarmDetails(schedule) {
    const details = document.getElementById("medAlarmDetails");
    if (!details || !schedule) return;

    const patientLabel = resolvePatientLabel(schedule.patient_id);
    details.innerHTML = `
      <div class="med-alarm-card">
        <div class="med-alarm-med-name">${schedule.medicine_name || "Medication"}</div>
        <div class="med-alarm-meta">${schedule.dosage || "Dose not specified"}</div>
        <div class="med-alarm-meta">Scheduled for ${schedule.schedule_time || "—"}</div>
        <div class="med-alarm-meta">Patient: ${patientLabel}</div>
      </div>
    `;
  }

  function showMedicationAlarm(schedule) {
    if (!schedule) return;
    activeReminder = schedule;
    const modal = document.getElementById("medAlarmModal");
    const title = document.getElementById("medAlarmTitle");
    const desc = document.getElementById("medAlarmDesc");

    if (title) {
      title.textContent = `Time for ${schedule.medicine_name || "medication"}`;
    }
    if (desc) {
      desc.textContent = `It's ${schedule.schedule_time || "now"}. Please confirm whether this dose was taken.`;
    }
    renderAlarmDetails(schedule);
    modal?.classList.add("open");
    startAlarmSound();
  }

  function closeMedicationAlarm() {
    document.getElementById("medAlarmModal")?.classList.remove("open");
    stopAlarmSound();
    activeReminder = null;
    processReminderQueue();
  }

  function processReminderQueue() {
    if (activeReminder || !dueReminderQueue.length) return;
    const next = dueReminderQueue.shift();
    if (next) showMedicationAlarm(next);
  }

  function queueMedicationAlarms(dueItems) {
    dueItems.forEach((item) => {
      const alreadyQueued = dueReminderQueue.some(
        (queued) => queued.id === item.id,
      );
      const isActive = activeReminder?.id === item.id;
      if (!alreadyQueued && !isActive) dueReminderQueue.push(item);
    });
    processReminderQueue();
  }

  function checkMedicationReminders() {
    const dueNow = getDueMedications(new Date());
    if (dueNow.length) queueMedicationAlarms(dueNow);
  }

  function startMedicationReminderWatcher() {
    loadDismissedReminders();
    checkMedicationReminders();
    if (reminderCheckTimer) window.clearInterval(reminderCheckTimer);
    reminderCheckTimer = window.setInterval(
      checkMedicationReminders,
      REMINDER_CHECK_MS,
    );
  }

  async function updateScheduleStatus(id, status) {
    return window.CaregiverAPI.apiJson(`/api/medications/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }

  async function handleAlarmAction(status) {
    if (!activeReminder) return;

    const scheduleId = activeReminder.id;
    const actionBtn =
      status === "taken"
        ? document.getElementById("medAlarmTaken")
        : status === "missed"
          ? document.getElementById("medAlarmMissed")
          : null;

    if (status === "snooze") {
      snoozeUntilById[scheduleId] = Date.now() + SNOOZE_MS;
      toast("Reminder snoozed for 5 minutes", "info");
      closeMedicationAlarm();
      return;
    }

    try {
      if (actionBtn) {
        window.CaregiverAPI.setLoadingState(actionBtn, true, "Saving...");
      }
      await updateScheduleStatus(scheduleId, status);
      persistDismissedReminder(scheduleId);
      toast(
        `Medication marked as ${status}`,
        status === "missed" ? "warning" : "success",
      );
      await window.refreshMedications?.();
      closeMedicationAlarm();
    } catch (error) {
      toast(error?.message || "Unable to update medication status", "error");
    } finally {
      if (actionBtn) window.CaregiverAPI.setLoadingState(actionBtn, false);
    }
  }

  function bindModalEvents() {
    document
      .getElementById("medAlarmTaken")
      ?.addEventListener("click", () => handleAlarmAction("taken"));
    document
      .getElementById("medAlarmMissed")
      ?.addEventListener("click", () => handleAlarmAction("missed"));
    document
      .getElementById("medAlarmSnooze")
      ?.addEventListener("click", () => handleAlarmAction("snooze"));
    document.getElementById("medAlarmModal")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        if (activeReminder) persistDismissedReminder(activeReminder.id);
        closeMedicationAlarm();
      }
    });
  }

  function installRefreshHook() {
    if (refreshHookInstalled) return;
    refreshHookInstalled = true;

    const previousRefresh = window.refreshMedications;
    window.refreshMedications = async function medicationReminderRefreshHook(
      ...args
    ) {
      await reloadSchedules();
      checkMedicationReminders();
      if (pageRefreshHandler) await pageRefreshHandler(schedules);
      if (
        typeof previousRefresh === "function" &&
        previousRefresh !== window.refreshMedications
      ) {
        await previousRefresh.apply(this, args);
      }
    };
  }

  async function bootstrapMedicationReminder() {
    if (!hasCaregiverSession() || !window.CaregiverAPI) return;

    ensureModalMarkup();
    bindModalEvents();
    installRefreshHook();
    await loadPatients().catch(() => {});
    await reloadSchedules().catch(() => []);
    startMedicationReminderWatcher();
  }

  window.MedicationReminder = {
    init: bootstrapMedicationReminder,
    checkNow: checkMedicationReminders,
    getSchedules: () => schedules,
    setPageRefreshHandler(handler) {
      pageRefreshHandler = handler;
    },
  };

  window.addEventListener("DOMContentLoaded", bootstrapMedicationReminder);
  window.addEventListener("beforeunload", () => {
    stopAlarmSound();
    if (reminderCheckTimer) window.clearInterval(reminderCheckTimer);
  });
})();
