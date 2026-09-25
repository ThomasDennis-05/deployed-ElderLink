import requests
import time

API_URL = "http://localhost:3000/api/sensor"
DEVICE_ID = "esp32-sim-01"

def trigger_fall(steps=5):
    z = 1.7
    for i in range(steps):
        z -= 0.35  # rapid drop each frame
        reading = {
            "device_id": DEVICE_ID,
            "frame_number": i,
            "x": 0.1,
            "y": 0.2,
            "z": round(max(z, 0.1), 2),
            "doppler_velocity": 2.5,  # spike well above the 1.5 threshold
        }
        r = requests.post(API_URL, json=reading)
        print(reading, "->", r.json())
        time.sleep(0.3)

if __name__ == "__main__":
    print("Triggering a fall now...")
    trigger_fall()
    print("Done. Check your dashboard and the fall_events table in Supabase.")  