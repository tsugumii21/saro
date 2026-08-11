import { CLIENT_STORAGE_KEYS } from "@saro/shared";

export const PERMISSION_KEYS = {
  LOCATION: "location",
  MICROPHONE: "microphone",
  PHONE: "phone",
};

export const PERMISSION_CONFIG = {
  location: {
    id: "location",
    title: "Location Access",
    shortTitle: "Location",
    description: "Panic and hazard reports share your exact position automatically so emergency dispatchers know where to send help.",
    iconName: "MapPin",
  },
  microphone: {
    id: "microphone",
    title: "Microphone Access",
    shortTitle: "Microphone",
    description: "Enables hands-free voice input when describing a hazard report.",
    iconName: "Mic",
  },
  phone: {
    id: "phone",
    title: "Phone & Dialer Access",
    shortTitle: "Phone / Call",
    description: "Allows the Panic button to immediately connect your phone's dialer directly to Legazpi 911.",
    iconName: "PhoneCall",
  },
};

const DEFAULT_PERMISSIONS = {
  location: "prompt", // "granted" | "denied" | "skipped" | "prompt"
  microphone: "prompt",
  phone: "prompt",
};

export function getPermissionsState() {
  if (typeof localStorage === "undefined") return DEFAULT_PERMISSIONS;
  try {
    const raw = localStorage.getItem(CLIENT_STORAGE_KEYS.PERMISSIONS_STATE);
    if (raw) {
      return { ...DEFAULT_PERMISSIONS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn("[SARO] Error reading permissions state:", e);
  }
  return DEFAULT_PERMISSIONS;
}

export function setPermissionState(key, status) {
  if (typeof localStorage === "undefined") return;
  try {
    const current = getPermissionsState();
    const updated = { ...current, [key]: status };
    localStorage.setItem(CLIENT_STORAGE_KEYS.PERMISSIONS_STATE, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn("[SARO] Error saving permission state:", e);
  }
}

export function isPrimingCompleted() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(CLIENT_STORAGE_KEYS.PERMISSION_PRIMING_DONE) === "true";
}

export function markPrimingCompleted() {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLIENT_STORAGE_KEYS.PERMISSION_PRIMING_DONE, "true");
}

export async function requestBrowserPermission(key) {
  if (key === "location") {
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => {
            setPermissionState("location", "granted");
            resolve("granted");
          },
          (err) => {
            if (err?.code === err?.PERMISSION_DENIED) {
              setPermissionState("location", "denied");
              resolve("denied");
            } else {
              setPermissionState("location", "granted");
              resolve("granted");
            }
          },
          { timeout: 5000 }
        );
      });
    }
  } else if (key === "microphone") {
    if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        setPermissionState("microphone", "granted");
        return "granted";
      } catch (err) {
        setPermissionState("microphone", "denied");
        return "denied";
      }
    }
  } else if (key === "phone") {
    setPermissionState("phone", "granted");
    return "granted";
  }

  setPermissionState(key, "granted");
  return "granted";
}
