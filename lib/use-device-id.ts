// lib/use-device-id.ts
// Generates a stable UUID per browser instance, stored in localStorage.
// Different browsers on the same machine get different IDs.
// Different devices on same WiFi get different IDs.
// Resets if user clears localStorage.
"use client";

import { useState, useEffect } from "react";

const DEVICE_ID_KEY = "shelby_device_id_v1";

function generateUUID(): string {
  // crypto.randomUUID() not available in all environments
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

let _cachedId: string | null = null;

export function getDeviceId(): string {
  if (_cachedId) return _cachedId;
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || id.length < 10) {
      id = generateUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    _cachedId = id;
    return id;
  } catch {
    // localStorage blocked (private browsing some configs)
    if (!_cachedId) _cachedId = generateUUID();
    return _cachedId;
  }
}

export function useDeviceId(): string {
  const [deviceId, setDeviceId] = useState<string>("");

  useEffect(() => {
    setDeviceId(getDeviceId());
  }, []);

  return deviceId;
}