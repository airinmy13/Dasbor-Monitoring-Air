#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <UniversalTelegramBot.h>
#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// addons helper for Firebase
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// ====================================================================
// CONFIGURATION BLOCK (Adjust pin numbers and thresholds as needed)
// ====================================================================

// Firebase Credentials
#define API_KEY "AIzaSyCKV5zZOpyrs4L_bGWxFcVr6v0P3w97Ias"
#define DATABASE_URL "https://smart-water-tank-esp32-default-rtdb.firebaseio.com/" 

// Telegram Bot Credentials
#define BOT_TOKEN "8633484581:AAEWxLKj2Cmos5E494ouD7qR6ivX5HDRx30"
#define CHAT_ID   "12345" // Ganti dengan Chat ID Telegram Anda (angka unik)

// HC-SR04 Ultrasonic Pin Definitions
#define PIN_TRIG 5
#define PIN_ECHO 18

// Physical Relay Pin Definitions (Adjust based on your ESP32 board)
#define PIN_RELAY_PUMP 19  // 12V Pump Relay
#define PIN_RELAY_OLED 23  // 5V OLED Relay (TV simulation)
#define PIN_RELAY_FAN  17  // 7V Cooling Fan Relay
#define PIN_RELAY_LED1 16  // 3V LED Room 1 Relay
#define PIN_RELAY_LED2 4   // 3V LED Room 2 Relay

// Active states for Relays (depends on relay board, typically LOW is active for Arduino relay shields)
#define RELAY_ON  LOW
#define RELAY_OFF HIGH

// Tank physical measurements (in cm)
const float TANK_MAX_HEIGHT = 20.0; // Sensor distance in cm when tank is 0% full (empty)
const float TANK_MIN_HEIGHT = 2.0;  // Sensor distance in cm when tank is 100% full

// Voltage values for load-shedding
const int PUMP_V = 12;
const int OLED_V = 5;
const int FAN_V  = 7;
const int LED1_V = 3;
const int LED2_V = 3;
const int VOLTAGE_LIMIT = 25;

// ====================================================================
// GLOBALS & INSTANCES
// ====================================================================

// LCD 20x4 and OLED SSD1306 128x64 display configurations
LiquidCrystal_I2C lcd(0x27, 20, 4);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

// Wifi secure client for Telegram HTTPS connections
WiFiClientSecure secured_client;
UniversalTelegramBot bot(BOT_TOKEN, secured_client);

// Firebase configurations
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// State variables
float waterLevel = 75.0;            // Water percentage (0-100)
bool pumpState = false;             // Pump status
bool isFilling = false;             // System filling mode status
bool sensorFault = false;           // Sensor error flag
int totalLoad = 18;                 // Total voltage usage in Volts

// Variables to track user switches locally
bool userSwitches_oled = true;
bool userSwitches_fan = true;
bool userSwitches_led1 = true;
bool userSwitches_led2 = true;

// Relays physical states
bool relayStates_oled = true;
bool relayStates_fan = true;
bool relayStates_led1 = true;
bool relayStates_led2 = true;

// Keep track of shedded relays list
String sheddedRelays[4];
int sheddedCount = 0;

// Timing counters
unsigned long lastTelegramPoll = 0;
const unsigned long TELEGRAM_POLL_INTERVAL = 1500; // Poll Telegram every 1.5s
unsigned long lastFirebaseUpdate = 0;
const unsigned long FIREBASE_UPDATE_INTERVAL = 3000; // Push sensor data to Firebase every 3s
unsigned long lastFirebaseRead = 0;
const unsigned long FIREBASE_READ_INTERVAL = 1500; // Read commands from Firebase every 1.5s

// ====================================================================
// CORE FUNCTIONS
// ====================================================================

// Read Ultrasonic distance and calculate water percentage
float getWaterPercentage() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  
  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // 30ms timeout
  
  if (duration == 0) {
    sensorFault = true;
    return -1.0;
  }
  
  sensorFault = false;
  float distance = duration * 0.0343 / 2.0;
  
  // Calculate percentage based on tank heights
  if (distance >= TANK_MAX_HEIGHT) return 0.0;
  if (distance <= TANK_MIN_HEIGHT) return 100.0;
  
  float pct = ((TANK_MAX_HEIGHT - distance) / (TANK_MAX_HEIGHT - TANK_MIN_HEIGHT)) * 100.0;
  return pct;
}

// Calculate active electrical load
int calculateTotalLoad() {
  int currentLoad = 0;
  if (userSwitches_oled && relayStates_oled) currentLoad += OLED_V;
  if (userSwitches_fan && relayStates_fan) currentLoad += FAN_V;
  if (userSwitches_led1 && relayStates_led1) currentLoad += LED1_V;
  if (userSwitches_led2 && relayStates_led2) currentLoad += LED2_V;
  if (pumpState) currentLoad += PUMP_V;
  return currentLoad;
}

// Send message response to Telegram and sync it immediately to Firebase RTDB for the Web Dashboard Chat Log
void sendTelegramNotification(String msg) {
  // 1. Send to Telegram Bot Chat Group/Direct message
  bot.sendMessage(CHAT_ID, msg, "HTML");
  
  // 2. Write to Firebase so the Dashboard updates its simulated Telegram Chat UI in real-time
  String cleanMsg = msg;
  cleanMsg.replace("<b>", "");
  cleanMsg.replace("</b>", "");
  cleanMsg.replace("<br>", "\n");
  Firebase.RTDB.setString(&fbdo, "/telegram/last_message", "🤖 Bot: " + cleanMsg);
}

// Automatic Load Shedding algorithm to prevent overloading the 25V limit when Pump turns ON
void evaluateLoadAndShed() {
  int baseLoad = 0;
  if (userSwitches_oled && relayStates_oled) baseLoad += OLED_V;
  if (userSwitches_fan && relayStates_fan) baseLoad += FAN_V;
  if (userSwitches_led1 && relayStates_led1) baseLoad += LED1_V;
  if (userSwitches_led2 && relayStates_led2) baseLoad += LED2_V;
  
  int potentialTotal = baseLoad + PUMP_V;
  sheddedCount = 0;
  
  if (potentialTotal > VOLTAGE_LIMIT) {
    // Shed OLED (5V) first
    if (userSwitches_oled && relayStates_oled) {
      relayStates_oled = false;
      sheddedRelays[sheddedCount++] = "oled";
      sendTelegramNotification("⚡ <b>BEBAN BERLEBIH!</b> Mematikan <b>OLED Display (5V)</b> untuk mengosongkan beban sebelum pompa aktif.");
      potentialTotal -= OLED_V;
    }
    
    // Shed Fan (7V) next if still exceeding limit
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches_fan && relayStates_fan) {
      relayStates_fan = false;
      sheddedRelays[sheddedCount++] = "fan";
      sendTelegramNotification("⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>Cooling Fan (7V)</b>.");
      potentialTotal -= FAN_V;
    }
    
    // Shed LED Room 2 (3V) next if still exceeding limit
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches_led2 && relayStates_led2) {
      relayStates_led2 = false;
      sheddedRelays[sheddedCount++] = "led2";
      sendTelegramNotification("⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>LED Room 2 (3V)</b>.");
      potentialTotal -= LED2_V;
    }
    
    // Shed LED Room 1 (3V) next if still exceeding limit
    if (potentialTotal > VOLTAGE_LIMIT && userSwitches_led1 && relayStates_led1) {
      relayStates_led1 = false;
      sheddedRelays[sheddedCount++] = "led1";
      sendTelegramNotification("⚡ <b>BEBAN MASIH BERLEBIH!</b> Mematikan <b>LED Room 1 (3V)</b>.");
      potentialTotal -= LED1_V;
    }
    
    // Sync shedded states back to Firebase database
    for (int i = 0; i < sheddedCount; i++) {
      Firebase.RTDB.setBool(&fbdo, "/device/" + sheddedRelays[i], false);
    }
  }
}

// Restore shedded devices back to ON state when Pump turns OFF
void restoreSheddedDevices() {
  if (sheddedCount > 0) {
    String restoredList = "";
    for (int i = 0; i < sheddedCount; i++) {
      String dev = sheddedRelays[i];
      if (dev == "oled") relayStates_oled = true;
      else if (dev == "fan") relayStates_fan = true;
      else if (dev == "led1") relayStates_led1 = true;
      else if (dev == "led2") relayStates_led2 = true;
      
      // Update Firebase
      Firebase.RTDB.setBool(&fbdo, "/device/" + dev, true);
      
      restoredList += dev.toUpperCase() + " ";
    }
    sendTelegramNotification("🔄 Beban aman. Mengaktifkan kembali perangkat yang sebelumnya dimatikan: <b>" + restoredList + "</b>");
    sheddedCount = 0;
  }
}

// Update local physical GPIO pins based on current relay variables
void updatePhysicalRelays() {
  digitalWrite(PIN_RELAY_PUMP, (pumpState) ? RELAY_ON : RELAY_OFF);
  digitalWrite(PIN_RELAY_OLED, (userSwitches_oled && relayStates_oled) ? RELAY_ON : RELAY_OFF);
  digitalWrite(PIN_RELAY_FAN,  (userSwitches_fan && relayStates_fan) ? RELAY_ON : RELAY_OFF);
  digitalWrite(PIN_RELAY_LED1, (userSwitches_led1 && relayStates_led1) ? RELAY_ON : RELAY_OFF);
  digitalWrite(PIN_RELAY_LED2, (userSwitches_led2 && relayStates_led2) ? RELAY_ON : RELAY_OFF);
}

// Draw state details on I2C LCD Display
void updateLCD() {
  lcd.clear();
  if (sensorFault) {
    lcd.setCursor(0, 0); lcd.print("WATER LEVEL: ERROR! ");
    lcd.setCursor(0, 1); lcd.print("SENSOR ST: FAULT    ");
    lcd.setCursor(0, 2); lcd.print("LOAD: " + String(totalLoad) + "V (SAFE)    ");
    lcd.setCursor(0, 3); lcd.print("SYS: ALARM ACTIVE!  ");
  } else {
    lcd.setCursor(0, 0); lcd.print("WATER LEVEL: " + String(waterLevel, 1) + "% ");
    lcd.setCursor(0, 1); lcd.print("PUMP RELAY : " + String(pumpState ? "ON " : "OFF"));
    lcd.setCursor(0, 2); lcd.print("LOAD: " + String(totalLoad) + "V (" + String(totalLoad > VOLTAGE_LIMIT ? "OVERLOAD" : "SAFE") + ")     ");
    lcd.setCursor(0, 3); lcd.print(isFilling ? "SYS: FILLING MODE   " : "SYS: MONITORING MODE");
  }
}

// Draw simple status display on Adafruit SSD1306 OLED Screen
void updateOLED() {
  if (!(userSwitches_oled && relayStates_oled)) {
    oled.clearDisplay();
    oled.display();
    return; // Screen is powered OFF (Shedded or manual)
  }
  
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0,0);
  oled.println("--- SMART WATER TANK ---");
  oled.print("Water: "); oled.print(waterLevel, 1); oled.println("%");
  oled.print("Pump : "); oled.println(pumpState ? "ACTIVE (ON)" : "STANDBY (OFF)");
  oled.print("Load : "); oled.print(totalLoad); oled.println(" V");
  oled.println("------------------------");
  oled.print("System Mode: "); oled.println(isFilling ? "FILLING" : "MONITOR");
  oled.display();
}

// Handle Telegram chat messages
void handleNewTelegramMessages(int numNewMessages) {
  for (int i = 0; i < numNewMessages; i++) {
    String chat_id = String(bot.messages[i].chat_id);
    if (chat_id != CHAT_ID) {
      bot.sendMessage(chat_id, "Access Denied ❌. You are not authorized to control this Smart Tank.", "");
      continue;
    }
    
    String text = bot.messages[i].text;
    String from_name = bot.messages[i].from_name;
    
    // Log user command to Firebase so it displays instantly on the dashboard chat log
    Firebase.RTDB.setString(&fbdo, "/telegram/last_message", "👤 " + from_name + ": " + text);
    
    text.toLowerCase();
    
    if (text == "/status") {
      String activeDevs = "";
      if (userSwitches_oled && relayStates_oled) activeDevs += "OLED Display, ";
      if (userSwitches_fan && relayStates_fan) activeDevs += "Cooling Fan, ";
      if (userSwitches_led1 && relayStates_led1) activeDevs += "LED Room 1, ";
      if (userSwitches_led2 && relayStates_led2) activeDevs += "LED Room 2, ";
      if (activeDevs == "") activeDevs = "None";
      
      String response = "📊 <b>STATUS SYSTEM (REAL DEVICE):</b><br>"
                        "💧 Level Air: <b>" + String(waterLevel, 1) + "%</b><br>"
                        "🔌 Pompa: <b>" + (pumpState ? "ON 🔌" : "OFF 💤") + "</b><br>"
                        "⚡ Beban Listrik: <b>" + String(totalLoad) + "V</b> (Batas: 25V)<br>"
                        "⚙️ Mode: <b>" + (isFilling ? "Filling Mode" : "Monitoring Mode") + "</b><br>"
                        "📟 Device Aktif: <b>" + activeDevs + "</b><br>"
                        "📶 Sensor Status: <b>" + (sensorFault ? "⚠️ SENSOR FAULT!" : "NORMAL") + "</b>";
      sendTelegramNotification(response);
    }
    else if (text == "/help") {
      String response = "❓ <b>Daftar Perintah Bot:</b><br>"
                        "• <code>/status</code> - Cek level air, pompa, beban, dan mode saat ini.<br>"
                        "• <code>/devices</code> - Detail status alat (OLED, Kipas, LED1, LED2).<br>"
                        "• <code>/pump_on</code> - Paksa nyalakan pompa (Masuk mode pengisian jika aman).<br>"
                        "• <code>/pump_off</code> - Paksa matikan pompa (Kembali ke mode monitor).";
      sendTelegramNotification(response);
    }
    else if (text == "/devices") {
      String response = "📟 <b>STATUS PERANGKAT ELEKTRONIK:</b><br>"
                        "• OLED Display (5V): <b>" + String(userSwitches_oled ? (relayStates_oled ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)") + "</b><br>"
                        "• Kipas Angin (7V): <b>" + String(userSwitches_fan ? (relayStates_fan ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)") + "</b><br>"
                        "• LED Room 1 (3V): <b>" + String(userSwitches_led1 ? (relayStates_led1 ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)") + "</b><br>"
                        "• LED Room 2 (3V): <b>" + String(userSwitches_led2 ? (relayStates_led2 ? "ON" : "OFF (Auto Shedding)") : "OFF (Manual)") + "</b>";
      sendTelegramNotification(response);
    }
    else if (text == "/pump_on") {
      if (pumpState) {
        sendTelegramNotification("🔌 Pompa sudah dalam kondisi menyala.");
      } else {
        if (sensorFault) {
          sendTelegramNotification("❌ Gagal menyalakan pompa! Sensor ultrasonic mengalami gangguan.");
          return;
        }
        isFilling = true;
        sendTelegramNotification("🔌 Perintah diterima. Memulai pengisian air...");
        evaluateLoadAndShed();
        pumpState = true;
        Firebase.RTDB.setBool(&fbdo, "/device/pump", true);
      }
    }
    else if (text == "/pump_off") {
      if (!pumpState) {
        sendTelegramNotification("🔌 Pompa memang sudah dalam kondisi mati.");
      } else {
        isFilling = false;
        pumpState = false;
        Firebase.RTDB.setBool(&fbdo, "/device/pump", false);
        restoreSheddedDevices();
        sendTelegramNotification("🔌 Perintah diterima. Mematikan pompa, mengembalikan beban listrik, dan kembali ke mode monitoring.");
      }
    }
    else {
      sendTelegramNotification("❌ Perintah tidak dikenal. Ketik <code>/help</code> untuk daftar perintah.");
    }
  }
}

// ====================================================================
// SETUP
// ====================================================================
void setup() {
  Serial.begin(115200);
  
  // Set Pin Modes
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_RELAY_OLED, OUTPUT);
  pinMode(PIN_RELAY_FAN, OUTPUT);
  pinMode(PIN_RELAY_LED1, OUTPUT);
  pinMode(PIN_RELAY_LED2, OUTPUT);
  
  // Initialize Relays as OFF initially
  updatePhysicalRelays();
  
  // Initialize I2C LCD Display
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("System Initialization");
  lcd.setCursor(0, 1); lcd.print("Connecting WiFi...");
  
  // Initialize I2C OLED Display
  if(!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED allocation failed"));
  }
  oled.clearDisplay();
  oled.display();
  
  // Connect Wifi using WiFiManager (Captive portal page setup)
  WiFiManager wm;
  // wm.resetSettings(); // Uncomment if you want to clear saved WiFi credentials
  if (!wm.autoConnect("wm_smarttank_connect_ap")) {
    Serial.println("Failed to connect WiFi. Rebooting...");
    ESP.restart();
  }
  Serial.println("WiFi Connected!");
  lcd.setCursor(0, 2); lcd.print("WiFi: CONNECTED     ");
  
  // Initialize secured client with Telegram root certificate
  secured_client.setCACert(TELEGRAM_CERTIFICATE_ROOT);
  
  // Configure and connect to Firebase Realtime Database
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  
  // Sign in anonymously
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("Firebase anonymous sign up success.");
  } else {
    Serial.printf("Firebase sign up error: %s\n", config.signer.signupError.message.c_str());
  }
  
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  lcd.setCursor(0, 3); lcd.print("Firebase: CONNECTED ");
  delay(1500);
  
  sendTelegramNotification("🤖 ESP32 Booted Successfully! WiFi & Firebase Connected. Listening for commands.");
}

// ====================================================================
// LOOP
// ====================================================================
void loop() {
  // 1. Read sensor and handle automatic low water refill logic
  float currentPct = getWaterPercentage();
  if (currentPct >= 0.0) {
    waterLevel = currentPct;
  }
  
  if (!sensorFault) {
    // If water goes below 20% and we are not filling, activate filling mode
    if (waterLevel <= 20.0 && !isFilling) {
      isFilling = true;
      sendTelegramNotification("⚠️ <b>ESP32 ALERT:</b> Level air mencapai <b>" + String(waterLevel, 0) + "%</b>. Memasuki Mode Pengisian.");
      evaluateLoadAndShed();
      pumpState = true;
      Firebase.RTDB.setBool(&fbdo, "/device/pump", true);
    }
    
    // If water reaches 100% and we are filling, stop pump and restore shedded devices
    if (waterLevel >= 100.0 && isFilling) {
      isFilling = false;
      pumpState = false;
      Firebase.RTDB.setBool(&fbdo, "/device/pump", false);
      sendTelegramNotification("🎉 <b>ESP32 NOTIFICATION:</b> Level air telah mencapai 100%. Mematikan pompa.");
      restoreSheddedDevices();
    }
  } else {
    // Emergency stop if sensor fails during filling
    if (pumpState) {
      pumpState = false;
      isFilling = false;
      Firebase.RTDB.setBool(&fbdo, "/device/pump", false);
      restoreSheddedDevices();
      sendTelegramNotification("🚨 <b>EMERGENCY ALERT:</b> Pembacaan sensor ultrasonic gagal! Mematikan pompa untuk keselamatan.");
    }
  }
  
  // 2. Read switch controls from Firebase database (Pull once every 1.5s)
  if (millis() - lastFirebaseRead > FIREBASE_READ_INTERVAL) {
    lastFirebaseRead = millis();
    
    if (Firebase.RTDB.getJSON(&fbdo, "/device")) {
      FirebaseJson &json = fbdo.jsonObject();
      FirebaseJsonData jsonData;
      
      json.get(jsonData, "oled");
      if (jsonData.success && !jsonData.isNull) userSwitches_oled = jsonData.boolValue;
      
      json.get(jsonData, "fan");
      if (jsonData.success && !jsonData.isNull) userSwitches_fan = jsonData.boolValue;
      
      json.get(jsonData, "led1");
      if (jsonData.success && !jsonData.isNull) userSwitches_led1 = jsonData.boolValue;
      
      json.get(jsonData, "led2");
      if (jsonData.success && !jsonData.isNull) userSwitches_led2 = jsonData.boolValue;
      
      json.get(jsonData, "pump");
      if (jsonData.success && !jsonData.isNull) {
        bool fbPump = jsonData.boolValue;
        // If web user turned pump manually ON or OFF from Dashboard
        if (fbPump != pumpState) {
          pumpState = fbPump;
          if (pumpState) {
            isFilling = true;
            evaluateLoadAndShed();
          } else {
            isFilling = false;
            restoreSheddedDevices();
          }
        }
      }
    }
  }
  
  // 3. Periodic status updates to Firebase (every 3s)
  if (millis() - lastFirebaseUpdate > FIREBASE_UPDATE_INTERVAL) {
    lastFirebaseUpdate = millis();
    
    totalLoad = calculateTotalLoad();
    
    Firebase.RTDB.setFloat(&fbdo, "/water/level", waterLevel);
    Firebase.RTDB.setInt(&fbdo, "/device/voltage", totalLoad);
  }
  
  // 4. Poll Telegram for new chat commands (every 1.5s)
  if (millis() - lastTelegramPoll > TELEGRAM_POLL_INTERVAL) {
    int numNewMessages = bot.getUpdates(bot.last_message_received + 1);
    while (numNewMessages) {
      handleNewTelegramMessages(numNewMessages);
      numNewMessages = bot.getUpdates(bot.last_message_received + 1);
    }
    lastTelegramPoll = millis();
  }
  
  // 5. Update display screen and output pins
  updatePhysicalRelays();
  updateLCD();
  updateOLED();
}
