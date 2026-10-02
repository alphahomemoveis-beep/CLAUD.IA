import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { syncMetricool, syncPostStatuses, syncWindsor } from "@/lib/journal/service";

export const maxDuration = 300;

export const POST = route(async () => {
  const brand = await getBrand();
  const [windsor, metricool, posts] = await Promise.all([syncWindsor(brand), syncMetricool(brand), syncPostStatuses(brand)]);
  return json({ windsor, metricool, posts });
}, { role: "editor", rate: "ai" });
