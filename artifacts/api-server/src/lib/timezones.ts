/** Best-guess IANA time zone from a free-text location ("Austin, Texas, United States", "Bengaluru, India"...). */

const CITIES: Record<string, string> = {
  "new york": "America/New_York", boston: "America/New_York", miami: "America/New_York", atlanta: "America/New_York",
  chicago: "America/Chicago", dallas: "America/Chicago", houston: "America/Chicago", austin: "America/Chicago",
  denver: "America/Denver", phoenix: "America/Phoenix", "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  seattle: "America/Los_Angeles", "san diego": "America/Los_Angeles", toronto: "America/Toronto", vancouver: "America/Vancouver",
  london: "Europe/London", dublin: "Europe/Dublin", paris: "Europe/Paris", berlin: "Europe/Berlin", munich: "Europe/Berlin",
  amsterdam: "Europe/Amsterdam", madrid: "Europe/Madrid", barcelona: "Europe/Madrid", rome: "Europe/Rome", milan: "Europe/Rome",
  stockholm: "Europe/Stockholm", zurich: "Europe/Zurich", dubai: "Asia/Dubai", singapore: "Asia/Singapore", tokyo: "Asia/Tokyo",
  sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", perth: "Australia/Perth", auckland: "Pacific/Auckland",
  "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo", "mexico city": "America/Mexico_City", "hong kong": "Asia/Hong_Kong",
};

const US_STATES: Record<string, string> = {
  "new york": "America/New_York", massachusetts: "America/New_York", florida: "America/New_York", georgia: "America/New_York",
  "new jersey": "America/New_York", pennsylvania: "America/New_York", virginia: "America/New_York", "north carolina": "America/New_York",
  ohio: "America/New_York", michigan: "America/Detroit", maryland: "America/New_York", connecticut: "America/New_York",
  texas: "America/Chicago", illinois: "America/Chicago", minnesota: "America/Chicago", missouri: "America/Chicago", tennessee: "America/Chicago",
  wisconsin: "America/Chicago", louisiana: "America/Chicago", alabama: "America/Chicago", oklahoma: "America/Chicago", kansas: "America/Chicago",
  colorado: "America/Denver", utah: "America/Denver", "new mexico": "America/Denver", arizona: "America/Phoenix", idaho: "America/Boise",
  california: "America/Los_Angeles", washington: "America/Los_Angeles", oregon: "America/Los_Angeles", nevada: "America/Los_Angeles",
  hawaii: "Pacific/Honolulu", alaska: "America/Anchorage",
  ny: "America/New_York", ma: "America/New_York", fl: "America/New_York", ga: "America/New_York", nj: "America/New_York", pa: "America/New_York",
  tx: "America/Chicago", il: "America/Chicago", co: "America/Denver", az: "America/Phoenix", ca: "America/Los_Angeles", wa: "America/Los_Angeles",
};

const COUNTRIES: Record<string, string> = {
  "united states": "America/New_York", usa: "America/New_York", "united kingdom": "Europe/London", uk: "Europe/London", england: "Europe/London",
  ireland: "Europe/Dublin", france: "Europe/Paris", germany: "Europe/Berlin", netherlands: "Europe/Amsterdam", spain: "Europe/Madrid",
  italy: "Europe/Rome", sweden: "Europe/Stockholm", switzerland: "Europe/Zurich", belgium: "Europe/Brussels", poland: "Europe/Warsaw",
  india: "Asia/Kolkata", "united arab emirates": "Asia/Dubai", uae: "Asia/Dubai", singapore: "Asia/Singapore", japan: "Asia/Tokyo",
  china: "Asia/Shanghai", australia: "Australia/Sydney", "new zealand": "Pacific/Auckland", canada: "America/Toronto", brazil: "America/Sao_Paulo",
  mexico: "America/Mexico_City", "south africa": "Africa/Johannesburg", israel: "Asia/Jerusalem", nigeria: "Africa/Lagos", philippines: "Asia/Manila",
  indonesia: "Asia/Jakarta", "saudi arabia": "Asia/Riyadh", pakistan: "Asia/Karachi", bangladesh: "Asia/Dhaka",
};

const valid = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function guessTimezone(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.toLowerCase().split(/[,/|-]/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) if (CITIES[p]) return CITIES[p]!;
  // A US state only counts when the location is not clearly another country.
  const country = parts.map((p) => COUNTRIES[p]).find(Boolean);
  const isUs = !country || country === "America/New_York";
  if (isUs) for (const p of parts) if (US_STATES[p]) return US_STATES[p]!;
  return country ?? null;
}

export const isValidTimezone = valid;
