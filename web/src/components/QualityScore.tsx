import { qualityCoefficient } from "../domain/calculations";

export function QualityScore({ score }: { score: number }) {
  const tone = score >= 80 ? "high" : score >= 60 ? "mid" : "low";
  return (
    <div className={`quality-score quality-score-${tone}`}>
      <strong>{score || "—"}</strong>
      <span>{score ? `系数 ${qualityCoefficient(score).toFixed(2)}` : "等待评分"}</span>
    </div>
  );
}
