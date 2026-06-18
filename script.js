// ----------------------------------------------------
// FIREBASE REAL-TIME DATABASE SYNC
// ----------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyCKV5zZOpyrs4L_bGWxFcVr6v0P3w97Ias",
  authDomain: "smart-water-tank-esp32.firebaseapp.com",
  databaseURL: "https://smart-water-tank-esp32-default-rtdb.firebaseio.com",
  projectId: "smart-water-tank-esp32",
  storageBucket: "smart-water-tank-esp32.appspot.com",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Telegram Bot Credentials (matching your ESP32 configuration)
const BOT_TOKEN = "8633484581:AAEWxLKj2Cmos5E494ouD7qR6ivX5HDRx30";
const CHAT_ID = "6351746072"; // Ganti dengan Chat ID asli Anda jika bukan 12345

// ----------------------------------------------------
// SIMULATION STATE VARIABLES
// ----------------------------------------------------
let waterLevel = 75.0;            // Water volume (0% to 100%)
let isSimulating = true;          // Flag for active decay/filling simulation
let simSpeed = 2;                 // Speed multiplier (1 to 5)
let isFilling = false;            // System state: in monitoring vs. in filling phase
let pumpState = false;            // Pump relay state (ON/OFF)
let sensorFault = false;          // Mock sensor failure state
let uptimeSeconds = 0;            // ESP32 uptime simulation counter
let bootTimeLeft = 0;             // Tracks restart booting countdown steps
let isBooting = false;            // Booting lock flag

// Voltages definition
const PUMP_V = 12;
const OLED_V = 5;
const FAN_V = 7;
const LED1_V = 3;
const LED2_V = 3;
const VOLTAGE_LIMIT = 25;

// Track if user wants device to be active (User Switch toggle)
const userSwitches = {
  oled: true,
  fan: true,
  led1: true,
  led2: true
};

// Actual relays managed by ESP32 (Auto-shedding alters these)
const relayStates = {
  oled: true,
  fan: true,
  led1: true,
  led2: true
};

// Keep track of which relays were cut automatically to restore them later
let sheddedRelays = [];

// Active flowchart step index (1-8)
let currentFlowStep = 1;

// ----------------------------------------------------
// TIME / CLOCK HANDLER
// ----------------------------------------------------
function updateClock() {
  const now = new Date();
  const clockElement = document.getElementById('dashboard-clock');
  const dateElement = document.getElementById('dashboard-date');
  if (clockElement) {
    clockElement.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
  }
  if (dateElement) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateElement.textContent = now.toLocaleDateString('id-ID', options);
  }
}
setInterval(updateClock, 1000);
updateClock();

// ----------------------------------------------------
// DOM ELEMENT REFERENCES
// ----------------------------------------------------
const waterFill = document.getElementById('tank-water-fill');
const waterStream = document.getElementById('water-stream');
const waterPctText = document.getElementById('water-pct-text');
const waterStatusBadge = document.getElementById('water-status-badge');
const ultrasonicDist = document.getElementById('ultrasonic-dist');
const sensorStatusText = document.getElementById('sensor-status-text');
const sensorStatusIcon = document.getElementById('sensor-status-icon');
const tankAlarm = document.getElementById('tank-alarm');

const pumpVisualContainer = document.getElementById('pump-visual-container');
const pumpStatusBadge = document.getElementById('pump-status-badge');
const pumpDot = document.getElementById('pump-dot');
const pumpStatusTxt = document.getElementById('pump-status-txt');
const systemModeText = document.getElementById('system-mode-text');

const totalLoadText = document.getElementById('total-load-text');
const energyStatusBadge = document.getElementById('energy-status-badge');
const gaugeLoadArc = document.getElementById('gauge-load-arc');
const gaugeNeedle = document.getElementById('gauge-needle');

const powerAlertBox = document.getElementById('power-alert-box');
const powerAlertIconContainer = document.getElementById('power-alert-icon-container');
const powerAlertIcon = document.getElementById('power-alert-icon');
const powerAlertTitle = document.getElementById('power-alert-title');
const powerAlertDesc = document.getElementById('power-alert-desc');

const lcdLine1 = document.getElementById('lcd-line-1');
const lcdLine2 = document.getElementById('lcd-line-2');
const lcdLine3 = document.getElementById('lcd-line-3');
const lcdLine4 = document.getElementById('lcd-line-4');

const oledSwitch = document.getElementById('toggle-oled');
const fanSwitch = document.getElementById('toggle-fan');
const led1Switch = document.getElementById('toggle-led1');
const led2Switch = document.getElementById('toggle-led2');

const oledStatusLabel = document.getElementById('device-status-oled');
const fanStatusLabel = document.getElementById('device-status-fan');
const led1StatusLabel = document.getElementById('device-status-led1');
const led2StatusLabel = document.getElementById('device-status-led2');
const pumpStatusLabel = document.getElementById('device-status-pump');

const oledIcon = document.getElementById('device-icon-oled');
const fanIcon = document.getElementById('device-icon-fan');
const led1Icon = document.getElementById('device-icon-led1');
const led2Icon = document.getElementById('device-icon-led2');
const pumpIcon = document.getElementById('device-icon-pump');
const pumpLabel = document.getElementById('device-label-pump');

const oledItem = document.getElementById('device-item-oled');
const fanItem = document.getElementById('device-item-fan');
const led1Item = document.getElementById('device-item-led1');
const led2Item = document.getElementById('device-item-led2');
const pumpItem = document.getElementById('device-item-pump');

const mockOledTv = document.getElementById('mock-oled-tv');
const mockOledScreen = document.getElementById('mock-oled-screen');
const mockOledScreenOff = document.getElementById('mock-oled-screen-off');
const mockFanBlades = document.getElementById('mock-fan-blades');
const mockLed1 = document.getElementById('mock-led-1');
const mockLed2 = document.getElementById('mock-led-2');
const mockLedStatusText = document.getElementById('mock-status-text-led');
const mockLedStatusDot = document.getElementById('mock-status-dot-led');
const mockOledStatusText = document.getElementById('mock-status-text-oled');
const mockOledStatusDot = document.getElementById('mock-status-dot-oled');
const mockFanStatusText = document.getElementById('mock-status-text-fan');
const mockFanStatusDot = document.getElementById('mock-status-dot-fan');
const mockPump = document.getElementById('mock-pump');
const mockPumpStatusText = document.getElementById('mock-status-text-pump');
const mockPumpStatusDot = document.getElementById('mock-status-dot-pump');

const overrideSlider = document.getElementById('override-water-slider');
const overrideLabel = document.getElementById('override-pct-label');
const speedSlider = document.getElementById('sim-speed-slider');
const speedLabel = document.getElementById('sim-speed-label');
const btnToggleSim = document.getElementById('btn-toggle-sim');
const simBtnText = document.getElementById('sim-btn-text');
const simPlayIcon = document.getElementById('sim-play-icon');
const btnResetHw = document.getElementById('btn-reset-hw');
const sensorFaultToggle = document.getElementById('sensor-fault-toggle');

const telegramLogs = document.getElementById('telegram-chat-logs');
const tgCommandForm = document.getElementById('tg-command-form');
const tgCommandInput = document.getElementById('tg-command-input');

const espUptimeVal = document.getElementById('esp-uptime-val');
const esp32StatusLed = document.getElementById('esp32-status-led');
const esp32PowerLed = document.getElementById('esp32-power-led');
const esp32WifiLed = document.getElementById('esp32-wifi-led');
const esp32WifiTxt = document.getElementById('esp32-wifi-txt');
const espStatusText = document.getElementById('esp-status-text');
const espStatusDot = document.getElementById('esp-status-dot');

// Set initial Telegram time stamps
const initialTimeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
document.getElementById('tg-init-time').textContent = initialTimeStr;

// ----------------------------------------------------
// LOGGING / TELEGRAM HELPER
// ----------------------------------------------------
function addTelegramMessage(sender, text, isBot = true, time = null) {
  if (!time) {
    time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  const bubble = document.createElement('div');
  if (isBot) {
    bubble.className = "flex items-start space-x-2 bg-white p-3 rounded-2xl shadow-xs border border-orange-50/30 transition-all duration-300 animate-slide-in";
    bubble.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white flex-shrink-0 text-xs font-bold font-mono shadow-xs select-none">🤖</div>
    <div class="flex-1 text-xs">
      <div class="flex items-center justify-between mb-0.5">
        <span class="font-bold text-accent-brown">${sender} <span class="bg-blue-100 text-blue-700 text-[8px] px-1 rounded-sm">Bot</span></span>
        <span class="text-[9px] text-gray-400">${time}</span>
      </div>
      <div class="text-gray-600 leading-normal font-sans">${text}</div>
    </div>
  `;
  } else {
    bubble.className = "flex items-start space-x-2 bg-blue-50/80 p-3 rounded-2xl shadow-xs border border-blue-100/30 self-end ml-12 transition-all duration-300 animate-slide-in";
    bubble.innerHTML = `
    <div class="flex-1 text-xs text-right">
      <div class="flex items-center justify-between mb-0.5">
        <span class="text-[9px] text-gray-400">${time}</span>
        <span class="font-bold text-accent-brown">${sender}</span>
      </div>
      <div class="text-gray-700 font-mono text-[11.5px]">${text}</div>
    </div>
    <div class="w-8 h-8 rounded-full bg-accent-brown flex items-center justify-center text-white flex-shrink-0 text-xs font-bold shadow-xs select-none">👤</div>
  `;
  }
  telegramLogs.appendChild(bubble);
  telegramLogs.scrollTop = telegramLogs.scrollHeight;
}

// Helper for simulated typing delay
function botResponse(responseText, delay = 800) {
  // Add temporary typing element
  const typingBubble = document.createElement('div');
  typingBubble.className = "flex items-start space-x-2 bg-white p-2.5 rounded-2xl shadow-xs border border-orange-50/30 w-fit animate-pulse";
  typingBubble.id = "tg-typing-indicator";
  typingBubble.innerHTML = `
  <div class="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white flex-shrink-0 text-xs font-bold font-mono shadow-xs select-none">🤖</div>
  <div class="p-2 text-xs font-semibold text-gray-400 italic">Typing...</div>
`;
  telegramLogs.appendChild(typingBubble);
  telegramLogs.scrollTop = telegramLogs.scrollHeight;

  setTimeout(() => {
    const el = document.getElementById("tg-typing-indicator");
    if (el) el.remove();
    addTelegramMessage("SmartTank Bot", responseText, true);
  }, delay);
}

// ----------------------------------------------------
// HARDWARE RESET SIMULATION
// ----------------------------------------------------
function resetESP32() {
  isBooting = true;
  bootTimeLeft = 4;
  isSimulating = false;
  isFilling = false;
  pumpState = false;
  sensorFault = false;
  sensorFaultToggle.checked = false;
  uptimeSeconds = 0;

  // Disable inputs
  btnToggleSim.disabled = true;
  overrideSlider.disabled = true;
  btnResetHw.disabled = true;

  // Reset Relays
  for (let d in relayStates) {
    relayStates[d] = true;
  }
  sheddedRelays = [];

  // Trigger board status changes
  espStatusText.textContent = "Rebooting...";
  espStatusText.classList.add("text-status-red");
  espStatusDot.className = "w-2 h-2 rounded-full bg-status-red animate-ping";
  esp32StatusLed.className = "w-2 h-2 rounded-full bg-slate-700";
  esp32WifiLed.className = "w-2 h-2 rounded-full bg-slate-700";
  esp32WifiTxt.textContent = "WIFI: DISCONNECTED";

  addTelegramMessage("SmartTank Bot", "🔄 ESP32 System reboot requested. Connection lost.");

  runBootSequence();
}

function runBootSequence() {
  if (bootTimeLeft === 4) {
    lcdLine1.textContent = "====================";
    lcdLine2.textContent = "   ESP32 BOOTING    ";
    lcdLine3.textContent = "   SDK VERSION 4.4  ";
    lcdLine4.textContent = "====================";
    bootTimeLeft--;
    setTimeout(runBootSequence, 750);
  } else if (bootTimeLeft === 3) {
    lcdLine1.textContent = "INIT COMPONENTS...  ";
    lcdLine2.textContent = "ULTRASONIC SEN: OK  ";
    lcdLine3.textContent = "RELAY SYSTEM  : OK  ";
    lcdLine4.textContent = "OLED & LCD I2C: OK  ";
    bootTimeLeft--;
    setTimeout(runBootSequence, 750);
  } else if (bootTimeLeft === 2) {
    lcdLine1.textContent = "WIFI CONNECTING...  ";
    lcdLine2.textContent = "SSID: SmartIoT_AP   ";
    lcdLine3.textContent = "IP: 192.168.1.144   ";
    lcdLine4.textContent = "RSSI: -65 dBm (OK)  ";
    esp32WifiLed.className = "w-2 h-2 rounded-full bg-amber-500 animate-pulse";
    esp32WifiTxt.textContent = "WIFI: CONNECTING";
    bootTimeLeft--;
    setTimeout(runBootSequence, 750);
  } else if (bootTimeLeft === 1) {
    lcdLine1.textContent = "TELEGRAM CLIENT: OK ";
    lcdLine2.textContent = "BOT INSTANCE ID:    ";
    lcdLine3.textContent = "  @SmartTank_Bot    ";
    lcdLine4.textContent = "CONNECTING OK. START";
    esp32WifiLed.className = "w-2 h-2 rounded-full bg-status-green";
    esp32WifiTxt.textContent = "WIFI: CONNECTED";
    bootTimeLeft--;
    setTimeout(runBootSequence, 750);
  } else {
    isBooting = false;
    isSimulating = true;
    btnToggleSim.disabled = false;
    overrideSlider.disabled = false;
    btnResetHw.disabled = false;

    espStatusText.textContent = "Connected";
    espStatusText.classList.remove("text-status-red");
    espStatusDot.className = "w-2 h-2 rounded-full bg-status-green animate-ping";
    esp32StatusLed.className = "w-2 h-2 rounded-full bg-cyan-400";

    // Update Simulation Controls Buttons UI
    simBtnText.textContent = "Pause Sim";
    btnToggleSim.className = "flex-1 bg-accent-brown text-white py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 hover:bg-opacity-95 transition shadow-sm active:scale-95";
    simPlayIcon.innerHTML = `<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>`;

    addTelegramMessage("SmartTank Bot", "🤖 ESP32 booted successfully! WiFi connected. Listening for commands.");
    updateDashboardUI();
  }
}

// ----------------------------------------------------
// INTERACTIVE TELEGRAM COMMANDS
// ----------------------------------------------------
tgCommandForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const rawCommand = tgCommandInput.value;
  const command = rawCommand.trim().toLowerCase();
  if (command === "") return;

  addTelegramMessage("User", rawCommand, false);
  tgCommandInput.value = "";

  if (isBooting) {
    botResponse("❌ ESP32 System sedang booting, mohon tunggu beberapa saat...");
    return;
  }

  // If sync is active, send the command physically to the Telegram Bot API and write to Firebase
  if (useFirebaseData) {
    // Write user message to Firebase so it is archived/visible in real-time
    database.ref('telegram/last_message').set(`👤 User: ${rawCommand}`);

    // Send to Telegram Bot API via fetch
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: rawCommand
      })
    })
    .then(res => res.json())
    .then(data => {
      console.log("Telegram sendMessage response:", data);
      if (!data.ok) {
        addTelegramMessage("SmartTank Bot", "⚠️ Gagal mengirim ke Telegram. Pastikan BOT_TOKEN & CHAT_ID benar di script.js.", true);
      }
    })
    .catch(err => {
      console.error("Error sending to Telegram:", err);
      addTelegramMessage("SmartTank Bot", "⚠️ Error koneksi saat mengirim ke Telegram.", true);
    });
  } else {
    // Process Telegram command locally (Simulator Mode)
    if (command === "/status") {
      let activeDevs = [];
      if (userSwitches.oled && relayStates.oled) activeDevs.push("OLED Display 📺");
      if (userSwitches.fan && relayStates.fan) activeDevs.push("Cooling Fan 🌀");
      if (userSwitches.led1 && relayStates.led1) activeDevs.push("LED 1 💡");
      if (userSwitches.led2 && relayStates.led2) activeDevs.push("LED 2 💡");

      const statusText = `
      📊 <b>STATUS SYSTEM (SIMULATOR):</b><br>
      💧 Level Air : <b>${waterLevel.toFixed(1)}%</b><br>
      🔌 Pompa : <b>${pumpState ? "ON 🔌" : "OFF 💤"}</b><br>
      ⚡ Beban Listrik : <b>${calculateTotalLoad()}V</b> (Batas: 25V)<br>
      ⚙️ Mode : <b>${isFilling ? "Filling Mode (Pengisian)" : "Monitoring Mode"}</b><br>
      📟 Device Aktif : ${activeDevs.length > 0 ? activeDevs.join(", ") : "Tidak Ada"}<br>
      📶 Sensor Status: <b>${sensorFault ? "⚠ SENSOR ERROR!" : "NORMAL"}</b>
    `;
      botResponse(statusText);
    }
    else if (command === "/help") {
      const helpText = `
      ❓ <b>Daftar Perintah Bot (SIMULATOR):</b><br>
      • <code>/status</code> - Cek level air, pompa, beban, dan mode saat ini.<br>
      • <code>/devices</code> - Detail status alat (OLED, Kipas, LED1, LED2).<br>
      • <code>/pump_on</code> - Paksa nyalakan pompa (Masuk mode pengisian jika aman).<br>
      • <code>/pump_off</code> - Paksa matikan pompa (Kembali ke mode monitor).
    `;
      botResponse(helpText);
    }
    else if (command === "/devices") {
      const devText = `
      📟 <b>STATUS PERANGKAT ELEKTRONIK (SIMULATOR):</b><br>
      • OLED Display (5V): <b>${userSwitches.oled ? (relayStates.oled ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)"}</b><br>
      • Kipas Angin (7V): <b>${userSwitches.fan ? (relayStates.fan ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)"}</b><br>
      • LED Room 1 (3V): <b>${userSwitches.led1 ? (relayStates.led1 ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)"}</b><br>
      • LED Room 2 (3V): <b>${userSwitches.led2 ? (relayStates.led2 ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)"}</b>
    `;
      botResponse(devText);
    }
    else if (command === "/pump_on") {
      if (pumpState) {
        botResponse("🔌 Pompa sudah dalam kondisi menyala.");
      } else {
        if (sensorFault) {
          botResponse("❌ Gagal menyalakan pompa! Sensor ultrasonic mengalami gangguan.");
          return;
        }
        isFilling = true;
        botResponse("🔌 Perintah diterima. Memulai pengisian air (Masuk mode filling)...");
      }
    }
    else if (command === "/pump_off") {
      if (!pumpState) {
        botResponse("🔌 Pompa memang sudah dalam kondisi mati.");
      } else {
        isFilling = false;
        pumpState = false;
        restoreSheddedDevices();
        botResponse("🔌 Perintah diterima. Mematikan pompa, mengembalikan beban listrik, dan kembali ke mode monitoring.");
      }
    }
    else {
      botResponse("❌ Perintah tidak dikenal. Ketik <code>/help</code> untuk daftar perintah.");
    }
  }
});

// ----------------------------------------------------
// ENERGY LOAD MANAGEMENT ALGORITHM
// ----------------------------------------------------
function calculateTotalLoad() {
  let load = 0;

  // OLED Display (5V)
  if (userSwitches.oled && relayStates.oled) load += OLED_V;

  // Cooling Fan (7V)
  if (userSwitches.fan && relayStates.fan) load += FAN_V;

  // LED 1 (3V)
  if (userSwitches.led1 && relayStates.led1) load += LED1_V;

  // LED 2 (3V)
  if (userSwitches.led2 && relayStates.led2) load += LED2_V;

  // Water Pump (12V)
  if (pumpState) load += PUMP_V;

  return load;
}

// Core IoT Logic: Evaluates power limit and turns off devices based on priority
function evaluateLoadAndShed() {
  // Potential load is what the load will be with the pump (12V) active
  let baseLoadWithoutPump = 0;
  if (userSwitches.oled && relayStates.oled) baseLoadWithoutPump += OLED_V;
  if (userSwitches.fan && relayStates.fan) baseLoadWithoutPump += FAN_V;
  if (userSwitches.led1 && relayStates.led1) baseLoadWithoutPump += LED1_V;
  if (userSwitches.led2 && relayStates.led2) baseLoadWithoutPump += LED2_V;

  let potentialTotal = baseLoadWithoutPump + PUMP_V;

  // Check if shedding is required
  if (potentialTotal > VOLTAGE_LIMIT) {
    currentFlowStep = 4; // Step 4: Disable Device Priority

    // We need to shed load. Priority to turn off: OLED (5V) -> Fan (7V) -> LEDs (3V)
    // Shed OLED first
    if (userSwitches.oled && relayStates.oled) {
      relayStates.oled = false;
      sheddedRelays.push('oled');
      addTelegramMessage("SmartTank Bot", "⚡ <b>BEBAN BERLEBIH!</b> Mematikan <b>OLED Display (5V)</b> untuk mengosongkan beban sebelum pompa aktif.");
      potentialTotal -= OLED_V;
    }

    // If still exceeding 25V, shed Fan next
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches.fan && relayStates.fan) {
      relayStates.fan = false;
      sheddedRelays.push('fan');
      addTelegramMessage("SmartTank Bot", "⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>Cooling Fan (7V)</b>.");
      potentialTotal -= FAN_V;
    }

    // If still exceeding, shed LED 2
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches.led2 && relayStates.led2) {
      relayStates.led2 = false;
      sheddedRelays.push('led2');
      addTelegramMessage("SmartTank Bot", "⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>LED Room 2 (3V)</b>.");
      potentialTotal -= LED2_V;
    }

    // If still exceeding, shed LED 1
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches.led1 && relayStates.led1) {
      relayStates.led1 = false;
      sheddedRelays.push('led1');
      addTelegramMessage("SmartTank Bot", "⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>LED Room 1 (3V)</b>.");
      potentialTotal -= LED1_V;
    }
  }
}

// Restore shedded relays to normal ON states
function restoreSheddedDevices() {
  if (sheddedRelays.length > 0) {
    sheddedRelays.forEach(device => {
      relayStates[device] = true;
    });
    addTelegramMessage("SmartTank Bot", `🔄 Beban aman. Mengaktifkan kembali perangkat yang sebelumnya dimatikan: <b>${sheddedRelays.map(d => d.toUpperCase()).join(", ")}</b>`);
    sheddedRelays = [];
  }
}

// ----------------------------------------------------
// UPDATE UI FUNCTION
// ----------------------------------------------------
function updateDashboardUI() {
  if (isBooting) return;

  // 1. Water Tank Visual & Stats
  waterFill.style.height = `${waterLevel}%`;
  waterPctText.textContent = Math.round(waterLevel);

  // Wave speed changes if pump is active
  const waveEl = waterFill.querySelector('.water-wave');
  if (waveEl) {
    waveEl.style.animationDuration = pumpState ? '1.5s' : '3s';
  }

  // Inlet Pipe Stream
  if (pumpState) {
    waterStream.classList.remove('hidden');
  } else {
    waterStream.classList.add('hidden');
  }

  // Ultrasonic distance calculation: height is 20cm max (100% full = 0cm, 0% full = 20cm)
  const distanceVal = ((100 - waterLevel) * 20 / 100).toFixed(1);

  if (sensorFault) {
    ultrasonicDist.textContent = "ERR cm";
    sensorStatusText.textContent = "FAULT / ERROR";
    sensorStatusText.className = "text-xs font-bold text-status-red animate-pulse";
    sensorStatusIcon.className = "p-2 bg-red-50 rounded-lg text-status-red";
    tankAlarm.classList.remove('hidden');
    waterStatusBadge.className = "mt-2 flex items-center bg-status-red/10 text-status-red px-2 py-0.5 rounded-lg w-fit text-[10px] font-extrabold tracking-wider";
    waterStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-status-red mr-1 animate-ping"></span> ERROR`;
  } else {
    ultrasonicDist.textContent = `${distanceVal} cm`;
    sensorStatusText.textContent = "ACTIVE";
    sensorStatusText.className = "text-xs font-bold text-status-green";
    sensorStatusIcon.className = "p-2 bg-green-50 rounded-lg text-status-green";
    tankAlarm.classList.add('hidden');

    // Water level threshold badge color
    if (waterLevel <= 20) {
      waterStatusBadge.className = "mt-2 flex items-center bg-status-red/10 text-status-red px-2 py-0.5 rounded-lg w-fit text-[10px] font-extrabold tracking-wider";
      waterStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 bg-status-red rounded-full mr-1.5 animate-ping"></span> CRITICAL LOW`;
    } else if (waterLevel <= 50) {
      waterStatusBadge.className = "mt-2 flex items-center bg-accent-orange/10 text-accent-orange px-2 py-0.5 rounded-lg w-fit text-[10px] font-extrabold tracking-wider";
      waterStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 bg-accent-orange rounded-full mr-1.5"></span> MID LEVEL`;
    } else {
      waterStatusBadge.className = "mt-2 flex items-center bg-status-green/10 text-status-green px-2 py-0.5 rounded-lg w-fit text-[10px] font-extrabold tracking-wider";
      waterStatusBadge.innerHTML = `<svg class="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path clip-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fill-rule="evenodd"></path></svg> NORMAL`;
    }
  }

  // Update Slider Label
  overrideLabel.textContent = `${Math.round(waterLevel)}%`;
  overrideSlider.value = Math.round(waterLevel);

  // 2. Pump & Relays Badge
  if (pumpState) {
    pumpVisualContainer.className = "w-20 h-20 bg-status-green/10 rounded-full flex items-center justify-center border-2 border-status-green animate-pulse";
    pumpVisualContainer.querySelector('svg').className = "w-12 h-12 text-status-green shake-active";
    pumpStatusBadge.textContent = "ON";
    pumpStatusBadge.className = "text-xl font-black text-status-green";
    pumpDot.className = "w-1.5 h-1.5 rounded-full bg-status-green animate-ping";
    pumpStatusTxt.textContent = "Pump Active (12V)";
    pumpStatusTxt.className = "text-[9px] font-extrabold text-status-green uppercase";
  } else {
    pumpVisualContainer.className = "w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200";
    pumpVisualContainer.querySelector('svg').className = "w-12 h-12 text-accent-brown opacity-40";
    pumpStatusBadge.textContent = "OFF";
    pumpStatusBadge.className = "text-xl font-black text-status-red";
    pumpDot.className = "w-1.5 h-1.5 rounded-full bg-status-red";
    pumpStatusTxt.textContent = "Pump Stopped";
    pumpStatusTxt.className = "text-[9px] font-bold text-gray-400";
  }

  systemModeText.textContent = isFilling ? "Filling Mode" : "Monitoring Mode";

  // 3. Energy Management Stats
  const totalLoad = calculateTotalLoad();
  totalLoadText.textContent = totalLoad;

  // SVG Gauge math
  // dasharray is 125.6 (representing semi-circle of r=40). 
  // stroke-dashoffset = 125.6 * (1 - load/30)
  const dashOffset = 125.6 * (1 - totalLoad / 30);
  gaugeLoadArc.setAttribute('stroke-dashoffset', dashOffset);

  // Needle Angle: (load/30) * 180 - 90
  const needleAngle = (totalLoad / 30) * 180 - 90;
  gaugeNeedle.style.transform = `rotate(${needleAngle}deg)`;

  // Change arc color depending on load
  if (totalLoad > VOLTAGE_LIMIT) {
    gaugeLoadArc.setAttribute('stroke', '#ef4444'); // Red overload
    energyStatusBadge.className = "absolute bottom-0 left-1/2 -translate-x-1/2 bg-status-red/10 text-status-red px-3 py-0.5 rounded-full text-[10px] font-black border border-status-red/20";
    energyStatusBadge.textContent = "OVERLOAD";

    powerAlertBox.className = "mt-4 p-3 bg-red-50 rounded-2xl flex items-center justify-between border border-red-100";
    powerAlertIconContainer.className = "p-2 bg-status-red rounded-lg text-white";
    powerAlertIcon.innerHTML = `<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>`;
    powerAlertTitle.textContent = "OVERLOAD ALERT";
    powerAlertTitle.className = "text-xs font-bold text-status-red uppercase";
    powerAlertDesc.textContent = "Total load exceeds 25V maximum capacity!";
  } else {
    gaugeLoadArc.setAttribute('stroke', totalLoad >= 25 ? '#d97706' : '#22c55e'); // Orange warning or green safe
    energyStatusBadge.className = "absolute bottom-0 left-1/2 -translate-x-1/2 bg-status-green/10 text-status-green px-3 py-0.5 rounded-full text-[10px] font-black border border-status-green/20";
    energyStatusBadge.textContent = "SAFE";

    powerAlertBox.className = "mt-4 p-3 bg-green-50 rounded-2xl flex items-center justify-between border border-green-100";
    powerAlertIconContainer.className = "p-2 bg-status-green rounded-lg text-white";
    powerAlertIcon.innerHTML = `<path clip-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 4.946-2.597 9.29-6.518 11.771a1.304 1.304 0 01-1.464 0C6.012 16.29 3.415 11.946 3.415 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" fill-rule="evenodd"></path>`;
    powerAlertTitle.textContent = "ENERGY STATUS";
    powerAlertTitle.className = "text-xs font-bold text-status-green uppercase";
    powerAlertDesc.textContent = "Total system power load is within safe limits.";
  }

  // 4. Update Device switches list
  updateDeviceRow(oledSwitch, oledStatusLabel, oledIcon, oledItem, 'oled', OLED_V);
  updateDeviceRow(fanSwitch, fanStatusLabel, fanIcon, fanItem, 'fan', FAN_V);
  updateDeviceRow(led1Switch, led1StatusLabel, led1Icon, led1Item, 'led1', LED1_V);
  updateDeviceRow(led2Switch, led2StatusLabel, led2Icon, led2Item, 'led2', LED2_V);

  // Pump status row
  if (pumpState) {
    pumpStatusLabel.textContent = "ON";
    pumpStatusLabel.className = "text-[10px] font-extrabold text-status-green";
    pumpIcon.className = "p-2 bg-green-500 rounded-lg text-white animate-bounce";
    pumpLabel.className = "text-xs font-bold text-gray-800";
    pumpItem.className = "flex items-center justify-between p-2.5 bg-green-50/40 rounded-xl border border-green-100 shadow-sm";
  } else {
    pumpStatusLabel.textContent = "OFF";
    pumpStatusLabel.className = "text-[10px] font-extrabold text-status-red";
    pumpIcon.className = "p-2 bg-white rounded-lg shadow-xs text-gray-400";
    pumpLabel.className = "text-xs font-bold text-gray-400";
    pumpItem.className = "flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-transparent";
  }

  // 5. Physical Hardware mockups visual updates
  // OLED TV Screen Glow & animation
  if (userSwitches.oled && relayStates.oled) {
    mockOledTv.className = "w-28 h-20 bg-slate-950 border-4 border-slate-700 rounded-lg flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 shadow-lg ring-4 ring-cyan-500/10";
    mockOledScreen.classList.remove('hidden');
    mockOledScreen.classList.add('flex');
    mockOledScreenOff.classList.add('hidden');
    mockOledStatusText.textContent = "ON";
    mockOledStatusText.className = "text-xs font-bold uppercase text-status-green";
    mockOledStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-green";
  } else {
    mockOledTv.className = "w-28 h-20 bg-slate-900 border-4 border-slate-700 rounded-lg flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 shadow-md";
    mockOledScreen.classList.add('hidden');
    mockOledScreenOff.classList.remove('hidden');
    mockOledStatusText.className = "text-xs font-bold uppercase text-gray-400";
    mockOledStatusDot.className = "w-2.5 h-2.5 rounded-full bg-gray-300";
    if (!relayStates.oled && userSwitches.oled) {
      mockOledStatusText.textContent = "SHEDDED";
      mockOledStatusText.className = "text-xs font-extrabold uppercase text-status-red animate-pulse";
      mockOledStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-red animate-ping";
    } else {
      mockOledStatusText.textContent = "OFF";
    }
  }

  // Cooling Fan Spin animation
  if (userSwitches.fan && relayStates.fan) {
    mockFanBlades.classList.add('animate-spin-slow');
    mockFanStatusText.textContent = "ON";
    mockFanStatusText.className = "text-xs font-bold uppercase text-status-green";
    mockFanStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-green";
  } else {
    mockFanBlades.classList.remove('animate-spin-slow');
    mockFanStatusText.className = "text-xs font-bold uppercase text-gray-400";
    mockFanStatusDot.className = "w-2.5 h-2.5 rounded-full bg-gray-300";
    if (!relayStates.fan && userSwitches.fan) {
      mockFanStatusText.textContent = "SHEDDED";
      mockFanStatusText.className = "text-xs font-extrabold uppercase text-status-red animate-pulse";
      mockFanStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-red animate-ping";
    } else {
      mockFanStatusText.textContent = "OFF";
    }
  }

  // Room LEDs bulbs glow
  // LED 1
  if (userSwitches.led1 && relayStates.led1) {
    mockLed1.className = "w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center shadow-lg bulb-glow text-white transition-all duration-300";
  } else {
    mockLed1.className = "w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-500 transition-all duration-300";
  }
  // LED 2
  if (userSwitches.led2 && relayStates.led2) {
    mockLed2.className = "w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center shadow-lg bulb-glow text-white transition-all duration-300";
  } else {
    mockLed2.className = "w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-500 transition-all duration-300";
  }

  // LEDs common badge text
  let activeLedsCount = 0;
  if (userSwitches.led1 && relayStates.led1) activeLedsCount++;
  if (userSwitches.led2 && relayStates.led2) activeLedsCount++;

  if (activeLedsCount === 2) {
    mockLedStatusText.textContent = "BOTH ON";
    mockLedStatusText.className = "text-xs font-bold uppercase text-status-green";
    mockLedStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-green";
  } else if (activeLedsCount === 1) {
    mockLedStatusText.textContent = "1 ACTIVE";
    mockLedStatusText.className = "text-xs font-bold uppercase text-accent-orange";
    mockLedStatusDot.className = "w-2.5 h-2.5 rounded-full bg-accent-orange";
  } else {
    mockLedStatusDot.className = "w-2.5 h-2.5 rounded-full bg-gray-300";
    if ((!relayStates.led1 && userSwitches.led1) || (!relayStates.led2 && userSwitches.led2)) {
      mockLedStatusText.textContent = "SHEDDED";
      mockLedStatusText.className = "text-xs font-extrabold uppercase text-status-red animate-pulse";
      mockLedStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-red animate-ping";
    } else {
      mockLedStatusText.textContent = "BOTH OFF";
      mockLedStatusText.className = "text-xs font-bold uppercase text-gray-400";
    }
  }

  // Pump Mockup Animation
  if (pumpState) {
    mockPump.className = "w-16 h-16 rounded-2xl bg-green-500 text-white flex items-center justify-center shadow-lg relative transition-all shake-active border-2 border-green-400";
    mockPumpStatusText.textContent = "ACTIVE";
    mockPumpStatusText.className = "text-xs font-extrabold uppercase text-status-green animate-pulse";
    mockPumpStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-green animate-ping";
  } else {
    mockPump.className = "w-16 h-16 rounded-2xl bg-[#f8ead8]/60 border border-orange-100 flex items-center justify-center shadow-inner relative transition-all";
    mockPumpStatusText.textContent = "STOPPED";
    mockPumpStatusText.className = "text-xs font-bold uppercase text-status-red";
    mockPumpStatusDot.className = "w-2.5 h-2.5 rounded-full bg-status-red";
  }

  // 6. LCD text display rows updates
  if (sensorFault) {
    lcdLine1.textContent = "WATER LEVEL: ERROR! ";
    lcdLine2.textContent = "SENSOR ST: FAULT    ";
    lcdLine3.textContent = `LOAD: ${totalLoad}V (SAFE)    `;
    lcdLine4.textContent = "SYS: ALARM ACTIVE!  ";
  } else {
    lcdLine1.textContent = `WATER LEVEL: ${waterLevel.toFixed(1)}% `;
    lcdLine2.textContent = `PUMP RELAY : ${pumpState ? "ON " : "OFF"}`;
    lcdLine3.textContent = `LOAD: ${totalLoad}V (${totalLoad > VOLTAGE_LIMIT ? "OVERLOAD" : "SAFE"})     `;

    if (isFilling) {
      lcdLine4.textContent = "SYS: FILLING MODE   ";
    } else {
      lcdLine4.textContent = "SYS: MONITORING MODE";
    }
  }

  // 7. System Stepper flow node highlighting
  for (let i = 1; i <= 8; i++) {
    const node = document.getElementById(`step-node-${i}`);
    if (node) {
      if (i === currentFlowStep) {
        node.className = "flex flex-col items-center p-3 rounded-2xl border-2 border-accent-orange bg-orange-100/35 scale-105 shadow-md ring-4 ring-accent-orange/20 transition-all duration-300 w-full lg:w-32 z-10";
      } else {
        node.className = "flex flex-col items-center p-3 rounded-2xl border-2 border-orange-100 bg-white transition-all duration-300 w-full lg:w-32 shadow-xs z-0";
      }
    }
  }
}

// Helper function to update each device row in list
function updateDeviceRow(switchEl, labelEl, iconEl, itemEl, deviceKey, voltVal) {
  // Disabled if shedded (Auto cut off)
  const isShedded = !relayStates[deviceKey] && userSwitches[deviceKey];

  if (isShedded) {
    switchEl.checked = true;
    switchEl.disabled = true;
    switchEl.classList.add('opacity-40');

    labelEl.textContent = "SHEDDED";
    labelEl.className = "text-[9px] font-extrabold text-status-red animate-pulse";

    iconEl.className = "p-2 bg-red-100 rounded-lg text-status-red";

    itemEl.className = "flex items-center justify-between p-2.5 bg-red-50/50 rounded-xl border border-red-100 shadow-sm";
  } else {
    switchEl.disabled = false;
    switchEl.classList.remove('opacity-40');

    const isCurrentlyOn = userSwitches[deviceKey] && relayStates[deviceKey];
    switchEl.checked = isCurrentlyOn;

    if (isCurrentlyOn) {
      labelEl.textContent = "ON";
      labelEl.className = "text-[10px] font-extrabold text-status-green";

      iconEl.className = "p-2 bg-orange-100 text-accent-brown rounded-lg shadow-xs";
      itemEl.className = "flex items-center justify-between p-2.5 bg-white rounded-xl border border-orange-100/60 shadow-sm";
    } else {
      labelEl.textContent = "OFF";
      labelEl.className = "text-[10px] font-extrabold text-gray-400";

      iconEl.className = "p-2 bg-white rounded-lg shadow-xs text-gray-300 border border-gray-100";
      itemEl.className = "flex items-center justify-between p-2.5 bg-gray-50/50 rounded-xl border border-transparent";
    }
  }
}

// ----------------------------------------------------
// EVENT LISTENERS FOR CONTROLS
// ----------------------------------------------------

// User Device Switches toggles
function handleDeviceToggle(switchEl, deviceKey) {
  switchEl.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    userSwitches[deviceKey] = isChecked;

    // Write to Firebase if sync is enabled
    if (useFirebaseData) {
      database.ref('device/' + deviceKey).set(isChecked);
    }

    // Log event to Telegram bot
    const stateText = isChecked ? "ON" : "OFF";
    addTelegramMessage("SmartTank Bot", `👤 User manually turned <b>${deviceKey.toUpperCase()}</b> to <b>${stateText}</b>.`, true);

    // Re-evaluate load
    updateDashboardUI();
  });
}

handleDeviceToggle(oledSwitch, 'oled');
handleDeviceToggle(fanSwitch, 'fan');
handleDeviceToggle(led1Switch, 'led1');
handleDeviceToggle(led2Switch, 'led2');

// Manual water slider override
overrideSlider.addEventListener('input', (e) => {
  waterLevel = parseFloat(e.target.value);

  // If user changes level manually, evaluate state machine logic immediately
  if (!sensorFault) {
    if (waterLevel <= 20) {
      if (!isFilling) {
        isFilling = true;
        addTelegramMessage("SmartTank Bot", `⚠️ <b>SENSOR ALERT!</b> Water level detected <= 20% (${Math.round(waterLevel)}%). Entering filling mode.`);
        currentFlowStep = 2; // Step 2: Water <= 20%
      }
    } else if (waterLevel >= 100) {
      waterLevel = 100;
      if (isFilling) {
        isFilling = false;
        pumpState = false;
        currentFlowStep = 6; // Step 6: Tank Full
        addTelegramMessage("SmartTank Bot", `🎉 <b>SENSOR CONFIRMED!</b> Water tank is FULL (100%). Shutting off pump.`);
        restoreSheddedDevices();
        currentFlowStep = 7; // Step 7: Restore Devices
        setTimeout(() => { currentFlowStep = 1; }, 1000);
      }
    } else {
      // If water level gets manually set above 20% while monitoring, make sure pump stays off
      if (!isFilling) {
        pumpState = false;
        restoreSheddedDevices();
        currentFlowStep = 1; // Step 1: Monitor Level
      }
    }
  }

  updateDashboardUI();
});

// Simulation Speed changer
speedSlider.addEventListener('input', (e) => {
  simSpeed = parseInt(e.target.value);
  speedLabel.textContent = `${simSpeed}x`;
});

// Play/Pause simulation loop
btnToggleSim.addEventListener('click', () => {
  isSimulating = !isSimulating;

  if (isSimulating) {
    simBtnText.textContent = "Pause Sim";
    btnToggleSim.className = "flex-1 bg-accent-brown text-white py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 hover:bg-opacity-95 transition shadow-sm active:scale-95";
    simPlayIcon.innerHTML = `<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>`;
    addTelegramMessage("SmartTank Bot", "▶️ Simulation running. Water consumption simulated.");
  } else {
    simBtnText.textContent = "Resume Sim";
    btnToggleSim.className = "flex-1 bg-accent-orange text-white py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 hover:bg-opacity-95 transition shadow-sm active:scale-95";
    simPlayIcon.innerHTML = `<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>`;
    addTelegramMessage("SmartTank Bot", "⏸️ Simulation paused. Water level static.");
  }
});

// Restart ESP32 Dev board click
btnResetHw.addEventListener('click', () => {
  resetESP32();
});

// Sensor Fault override toggle
sensorFaultToggle.addEventListener('change', (e) => {
  sensorFault = e.target.checked;

  if (sensorFault) {
    addTelegramMessage("SmartTank Bot", "🚨 <b>SYSTEM ERROR ALERT!</b> Ultrasonic sensor connection lost or reading invalid distance. Alarm active.");
    if (pumpState) {
      pumpState = false;
      isFilling = false;
      restoreSheddedDevices();
      addTelegramMessage("SmartTank Bot", "🔌 Emergency shutdown: Pump relay forced OFF to prevent dry-running or overflow.");
    }
    currentFlowStep = 1; // reset flow
  } else {
    addTelegramMessage("SmartTank Bot", "✅ Sensor connection restored. Resuming normal operations.");
  }
  updateDashboardUI();
});

// ----------------------------------------------------
// SIMULATION MAIN INTERVAL LOOP (Run every 1s)
// ----------------------------------------------------
function simulationTick() {
  if (isBooting) return;

  uptimeSeconds++;

  // Uptime visual string format
  const minutes = Math.floor(uptimeSeconds / 60);
  const secs = uptimeSeconds % 60;
  espUptimeVal.textContent = `${minutes}m ${secs}s`;

  // Blink status LED on ESP32 board to show active loop
  esp32StatusLed.classList.add('bg-cyan-500');
  setTimeout(() => {
    if (!isBooting) {
      esp32StatusLed.className = "w-2 h-2 rounded-full bg-cyan-400";
    }
  }, 150);

  // If simulating, sensor has no fault, and we are NOT using real Firebase data, evaluate state machine step-by-step
  if (isSimulating && !sensorFault && !useFirebaseData) {

    // CASE 1: MONITORING PHASE (Water > 20%) - Water goes down gradually
    if (!isFilling) {
      currentFlowStep = 1; // Flow 1: Monitoring Mode

      // Simulating usage depletion
      waterLevel -= (0.4 * simSpeed);
      if (waterLevel <= 0) waterLevel = 0;

      // Critical threshold check
      if (waterLevel <= 20) {
        isFilling = true;
        currentFlowStep = 2; // Step 2: Critical Threshold Low
        addTelegramMessage("SmartTank Bot", `⚠️ <b>ESP32 ALERT:</b> Water level reached <b>${Math.round(waterLevel)}%</b> (Critical low <= 20%). Entering Filling Mode.`);

        // Wait briefly, evaluate load in next tick
        return;
      }
    }

    // CASE 2: FILLING PHASE (Water <= 20% to 100%) - Water fills up
    else {
      // If pump is not ON yet, run load balance analysis
      if (!pumpState) {
        currentFlowStep = 3; // Step 3: Check Energy Load

        // Check load & shed if necessary
        evaluateLoadAndShed();

        // Pump turns on
        pumpState = true;
        currentFlowStep = 5; // Step 5: Pump ON

        addTelegramMessage("SmartTank Bot", `🔌 <b>RELAY TRIGGER:</b> Pump relay turned <b>ON</b>. Filling tank...`);
      } else {
        currentFlowStep = 5; // Step 5: Pump ON (filling)

        // Fill tank
        waterLevel += (1.2 * simSpeed);

        if (waterLevel >= 100) {
          waterLevel = 100;
          currentFlowStep = 6; // Step 6: Tank Full

          addTelegramMessage("SmartTank Bot", `🎉 <b>ESP32 NOTIFICATION:</b> Water tank is completely FULL (100%).`);

          // Shut off pump
          pumpState = false;
          isFilling = false;

          currentFlowStep = 7; // Step 7: Restore shedded devices
          // Turn back ON shedded relays
          restoreSheddedDevices();

          // Reset flow stepper back to monitoring loop after 1.5 seconds
          setTimeout(() => {
            if (!isFilling) currentFlowStep = 8; // Step 8: Loop Back
            setTimeout(() => {
              if (!isFilling) currentFlowStep = 1;
            }, 1000);
          }, 1000);
        }
      }
    }
  }

  updateDashboardUI();
}

// Start the simulation loop ticker
setInterval(simulationTick, 1000);

// Initialize UI display values
updateDashboardUI();

// ----------------------------------------------------
// LISTEN TO FIREBASE FOR REAL-TIME SINKRONISASI
// ----------------------------------------------------

// Flag to indicate if real ESP32 connection is active
let useFirebaseData = true; 

const firebaseSyncToggle = document.getElementById('firebase-sync-toggle');
if (firebaseSyncToggle) {
  useFirebaseData = firebaseSyncToggle.checked;
  firebaseSyncToggle.addEventListener('change', (e) => {
    useFirebaseData = e.target.checked;
    if (useFirebaseData) {
      addTelegramMessage("SmartTank Bot", "🌐 Firebase Real-time Sync diaktifkan. Menghubungkan ke ESP32...");
      // Pull initial state once
      database.ref().once('value').then((snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (data.water && data.water.level !== undefined) waterLevel = parseFloat(data.water.level);
          if (data.device) {
            if (data.device.pump !== undefined) pumpState = data.device.pump;
            if (data.device.oled !== undefined) {
              relayStates.oled = data.device.oled;
              userSwitches.oled = data.device.oled;
            }
            if (data.device.fan !== undefined) {
              relayStates.fan = data.device.fan;
              userSwitches.fan = data.device.fan;
            }
            if (data.device.led1 !== undefined) {
              relayStates.led1 = data.device.led1;
              userSwitches.led1 = data.device.led1;
            }
            if (data.device.led2 !== undefined) {
              relayStates.led2 = data.device.led2;
              userSwitches.led2 = data.device.led2;
            }
          }
          updateDashboardUI();
        }
      });
    } else {
      addTelegramMessage("SmartTank Bot", "🔌 Firebase Sync dinonaktifkan. Beralih ke Mode Simulator Offline.");
    }
  });
}

database.ref('water/level').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    waterLevel = parseFloat(snapshot.val());
    updateDashboardUI();
  }
});

database.ref('device/pump').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    pumpState = snapshot.val();
    updateDashboardUI();
  }
});

database.ref('device/oled').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    relayStates.oled = snapshot.val();
    userSwitches.oled = snapshot.val();
    updateDashboardUI();
  }
});

database.ref('device/fan').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    relayStates.fan = snapshot.val();
    userSwitches.fan = snapshot.val();
    updateDashboardUI();
  }
});

database.ref('device/led1').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    relayStates.led1 = snapshot.val();
    userSwitches.led1 = snapshot.val();
    updateDashboardUI();
  }
});

database.ref('device/led2').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    relayStates.led2 = snapshot.val();
    userSwitches.led2 = snapshot.val();
    updateDashboardUI();
  }
});

database.ref('device/voltage').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    totalLoadText.textContent = snapshot.val();
  }
});

// Update Telegram simulated chat logs from actual bot messages
let isFirstTelegramLoad = true;
database.ref('telegram/last_message').on('value', (snapshot) => {
  if (snapshot.exists() && useFirebaseData) {
    const text = snapshot.val();
    if (isFirstTelegramLoad) {
      isFirstTelegramLoad = false;
      return;
    }
    // Append to simulated chat UI
    addTelegramMessage("SmartTank Bot", text, true);
  }
});

