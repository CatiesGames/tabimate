// stop 分類 → icon / 顏色 / 中文標籤 的唯一對照表。
import {
  AirplaneTilt,
  Bed,
  Bicycle,
  Binoculars,
  Boat,
  Bus,
  Car,
  Coffee,
  ForkKnife,
  MapPin,
  PersonSimpleWalk,
  ShoppingBag,
  Sparkle,
  Taxi,
  Train,
  type Icon,
} from "@phosphor-icons/react";

import type { LegMode, StopCategory } from "@/shared/config";

export const CATEGORY_META: Record<
  StopCategory,
  { label: string; icon: Icon; colorVar: string; twText: string; twBg: string }
> = {
  lodging: {
    label: "住宿",
    icon: Bed,
    colorVar: "var(--tm-cat-lodging)",
    twText: "text-cat-lodging",
    twBg: "bg-cat-lodging",
  },
  food: {
    label: "餐廳",
    icon: ForkKnife,
    colorVar: "var(--tm-cat-food)",
    twText: "text-cat-food",
    twBg: "bg-cat-food",
  },
  cafe: {
    label: "咖啡",
    icon: Coffee,
    colorVar: "var(--tm-cat-cafe)",
    twText: "text-cat-cafe",
    twBg: "bg-cat-cafe",
  },
  sight: {
    label: "景點",
    icon: Binoculars,
    colorVar: "var(--tm-cat-sight)",
    twText: "text-cat-sight",
    twBg: "bg-cat-sight",
  },
  shopping: {
    label: "購物",
    icon: ShoppingBag,
    colorVar: "var(--tm-cat-shopping)",
    twText: "text-cat-shopping",
    twBg: "bg-cat-shopping",
  },
  activity: {
    label: "體驗",
    icon: Sparkle,
    colorVar: "var(--tm-cat-activity)",
    twText: "text-cat-activity",
    twBg: "bg-cat-activity",
  },
  "transit-hub": {
    label: "交通樞紐",
    icon: Train,
    colorVar: "var(--tm-cat-transit-hub)",
    twText: "text-cat-transit-hub",
    twBg: "bg-cat-transit-hub",
  },
  other: {
    label: "其他",
    icon: MapPin,
    colorVar: "var(--tm-cat-other)",
    twText: "text-cat-other",
    twBg: "bg-cat-other",
  },
};

export const LEG_MODE_LABEL: Record<LegMode, string> = {
  walk: "步行",
  transit: "大眾運輸",
  drive: "開車",
  taxi: "計程車",
  bike: "單車",
  flight: "飛機",
  other: "其他",
};

export const LEG_MODE_ICON: Record<LegMode, Icon> = {
  walk: PersonSimpleWalk,
  transit: Train,
  drive: Car,
  taxi: Taxi,
  bike: Bicycle,
  flight: AirplaneTilt,
  other: Boat,
};

export { Bus };

/** Google place types → 分類推測。 */
export function guessCategory(types: string[]): StopCategory {
  const t = new Set(types);
  if (t.has("lodging") || t.has("hotel")) return "lodging";
  if (t.has("cafe") || t.has("coffee_shop")) return "cafe";
  if (t.has("restaurant") || t.has("food") || t.has("meal_takeaway") || t.has("bakery"))
    return "food";
  if (
    t.has("shopping_mall") ||
    t.has("department_store") ||
    t.has("store") ||
    t.has("market")
  )
    return "shopping";
  if (t.has("train_station") || t.has("subway_station") || t.has("transit_station") || t.has("airport"))
    return "transit-hub";
  if (t.has("amusement_park") || t.has("aquarium") || t.has("zoo") || t.has("spa"))
    return "activity";
  if (
    t.has("tourist_attraction") ||
    t.has("museum") ||
    t.has("park") ||
    t.has("place_of_worship") ||
    t.has("landmark")
  )
    return "sight";
  return "other";
}
