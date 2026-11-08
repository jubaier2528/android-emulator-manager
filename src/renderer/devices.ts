export interface CatalogDevice {
  id: string;
  name: string;
  brand: "Google Pixel" | "Samsung Galaxy" | "OnePlus" | "Xiaomi";
  accent: string;
  tone: string;
}

const colors = {
  pixel: ["#c9b8ff", "#dce9ff", "#a9c5ff", "#d7c7ff", "#e7d7ca", "#b8d6ca"],
  galaxy: ["#d9bce2", "#a9d8c6", "#d5dce5", "#9dadae", "#d8dfe8", "#c5d3eb"],
  oneplus: ["#e2a8a2", "#bec8d2", "#d3d5d4"],
  xiaomi: ["#e3bf98", "#b6c0cd", "#c7b9aa"]
};

const pixelNames = ["Pixel 10 Pro XL", "Pixel 10 Pro", "Pixel 10", "Pixel 9 Pro XL", "Pixel 9 Pro", "Pixel 9", "Pixel 8 Pro", "Pixel 8"];
const galaxyNames = ["Galaxy S25 Ultra", "Galaxy S25+", "Galaxy S25", "Galaxy S24 Ultra", "Galaxy S24", "Galaxy S23 Ultra", "Galaxy Z Fold", "Galaxy Z Flip"];
const oneplusNames = ["OnePlus 13", "OnePlus 12", "OnePlus 11"];
const xiaomiNames = ["Xiaomi 15", "Xiaomi 14", "Redmi Note series"];

function makeDevices(
  brand: CatalogDevice["brand"],
  names: string[],
  idPrefix: string,
  accent: string,
  palette: string[]
): CatalogDevice[] {
  return names.map((name, index) => ({
    id: `${idPrefix}-${name.toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`,
    name,
    brand,
    accent,
    tone: palette[index % palette.length]
  }));
}

export const devices: CatalogDevice[] = [
  ...makeDevices("Google Pixel", pixelNames, "pixel", "#a78bfa", colors.pixel),
  ...makeDevices("Samsung Galaxy", galaxyNames, "galaxy", "#6dbda4", colors.galaxy),
  ...makeDevices("OnePlus", oneplusNames, "oneplus", "#ed7967", colors.oneplus),
  ...makeDevices("Xiaomi", xiaomiNames, "xiaomi", "#f0a65e", colors.xiaomi)
];

export const brands = ["All devices", "Google Pixel", "Samsung Galaxy", "OnePlus", "Xiaomi"] as const;
