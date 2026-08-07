import { useState, useEffect } from "react";
import { CLIENT_STORAGE_KEYS } from "./constants.js";

const LANG_KEY = CLIENT_STORAGE_KEYS.LANGUAGE;

export const DICTIONARIES = {
  en: {
    appName: "SARO",
    appSubtitle: "Legazpi City Civic Hazard Door",
    publicMap: "Public Map",
    report: "File Report",
    track: "Track Reports",
    assistant: "AI Assistant",
    dashboard: "Responder Queue",
    admin: "City Admin & Routing",
    guest: "Guest (Anonymous)",
    resident: "Resident",
    responder: "Responder Staff",
    cityAdmin: "City Dispatch Admin",
    switchLanguage: "Language"
  },
  tl: {
    appName: "SARO",
    appSubtitle: "Pintuan ng Pag-uulat ng Panganib sa Legazpi",
    publicMap: "Pampublikong Mapa",
    report: "Mag-ulat ng Panganib",
    track: "Sundan ang Ulat",
    assistant: "AI Katulong",
    dashboard: "Pila ng Responder",
    admin: "Pangasiwaan ng Lungsod",
    guest: "Bisita (Anonimo)",
    resident: "Residente",
    responder: "Kawanihan ng Responder",
    cityAdmin: "Tagapangasiwa ng Lungsod",
    switchLanguage: "Wika"
  },
  bcl: {
    appName: "SARO",
    appSubtitle: "Bantayan nin Peligro sa Lungsod nin Legazpi",
    publicMap: "Mapa kan Publiko",
    report: "Mag-report nin Peligro",
    track: "Sundan ang Report",
    assistant: "AI Katabang",
    dashboard: "Pila nin Responder",
    admin: "Tagapamahala kan Lungsod",
    guest: "Bisita (Anonimo)",
    resident: "Residente",
    responder: "Kawanihan nin Responder",
    cityAdmin: "Tagapamahala kan Lungsod",
    switchLanguage: "Tataramon"
  }
};

export function useTranslation() {
  const [lang, setLang] = useState(() => {
    return localStorage.getItem(LANG_KEY) || "en";
  });

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  const t = (key) => {
    const dict = DICTIONARIES[lang] || DICTIONARIES.en;
    return dict[key] || DICTIONARIES.en[key] || key;
  };

  return { t, lang, setLang };
}
