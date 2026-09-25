#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "Wokwi-GUEST";
const char* password = "";

// Replace with your actual Supabase project values
const char* supabaseUrl = "https://tmtouqjgkteghxypirng.supabase.co";
const char* supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtdG91cWpna3RlZ2h4eXBpcm5nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDYxOTEyMywiZXhwIjoyMTAwMTk1MTIzfQ.MbWz7lJ0WjfG71xPQ0YyX15pARkbDE73PZrHh5H-fbE";

const int buttonPin = 4;
bool lastState = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
}

void sendFallEvent() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(supabaseUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", supabaseKey);
  http.addHeader("Authorization", String("Bearer ") + supabaseKey);
  http.addHeader("Prefer", "return=minimal");

  String payload = "{\"event_type\":\"fall_detected\",\"room\":\"104\",\"source\":\"simulated_sensor\"}";
  int code = http.POST(payload);

  Serial.print("POST response code: ");
  Serial.println(code);
  http.end();
}

void loop() {
  bool currentState = digitalRead(buttonPin);

  // Detect a press (HIGH -> LOW because of INPUT_PULLUP)
  if (lastState == HIGH && currentState == LOW) {
    Serial.println("Fall event triggered!");
    sendFallEvent();
    delay(1000); // simple debounce
  }

  lastState = currentState;
}