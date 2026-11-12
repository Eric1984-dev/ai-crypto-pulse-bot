import { generateRecommendations } from "../../../lib/recommendations.mjs";
import { ANALYTICS_CALCULATION_VERSION } from "./dashboard-analytics.mjs";

const TREND_METRICS = new Set(["Win rate", "Realized P&L", "Net P&L"]);

export function createAnalyticsInsights(analytics, previousRun = null) {
  const generated = generateRecommendations(analytics);
  const previous = Array.isArray(previousRun?.insights?.recommendations)
    ? previousRun.insights.recommendations
    : [];
  const recommendations = generated.recommendations.map((recommendation) => {
    const prior = previous.find(({ title, category }) =>
      title === recommendation.title && category === recommendation.category);
    const historicalTrend = compareRecommendationMetrics(recommendation, prior);
    const limitations = [
      "Recommendation is advisory only and is never applied automatically.",
      "ConfidenceLevel is a sample-size heuristic, not a probability or statistical confidence interval.",
      "Historical indicator and trade associations are descriptive, not causal."
    ];
    if (recommendation.sampleSize < 30) {
      limitations.push("The supporting sample is small and may be unstable.");
    }
    return Object.freeze({
      ...recommendation,
      confidenceBasis: "sample-size heuristic; not statistical probability",
      supportingSampleSize: recommendation.sampleSize,
      lastGenerationTimestamp: generated.generatedAt,
      historicalTrend,
      sourceDataCalculationVersion: ANALYTICS_CALCULATION_VERSION,
      limitations: Object.freeze(limitations)
    });
  });
  const byTitle = new Map(recommendations.map((item) => [item.title, item]));
  return Object.freeze({
    ...generated,
    calculationVersion: ANALYTICS_CALCULATION_VERSION,
    recommendations: Object.freeze(recommendations),
    categories: Object.freeze(generated.categories.map((category) => Object.freeze({
      ...category,
      recommendations: Object.freeze(category.recommendations.map((item) =>
        byTitle.get(item.title)
      ))
    })))
  });
}

function compareRecommendationMetrics(current, previous) {
  if (!previous || !Array.isArray(previous.metrics)) {
    return Object.freeze({ direction: "NO_MATCHING_BASELINE", metric: null });
  }
  for (const metric of current.metrics) {
    if (!TREND_METRICS.has(metric.label) || typeof metric.value !== "number") {
      continue;
    }
    const prior = previous.metrics.find((item) =>
      item.label === metric.label && typeof item.value === "number");
    if (!prior) {
      continue;
    }
    return Object.freeze({
      direction: metric.value > prior.value ? "INCREASING"
        : metric.value < prior.value ? "DECREASING" : "UNCHANGED",
      metric: metric.label,
      previousValue: prior.value,
      currentValue: metric.value
    });
  }
  return Object.freeze({ direction: "NO_COMPARABLE_METRIC", metric: null });
}
