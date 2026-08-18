import { qualityCoefficient } from "../domain/calculations";

export function QualityScore({
  score,
  ratio,
  passed,
}: {
  score: number;
  ratio?: number | null;
  passed?: boolean | null;
}) {
  const tone = score >= 80 ? "high" : passed === false ? "low" : "mid";
  const coefficient = ratio ?? qualityCoefficient(score);
  const hasScore = score !== null && score !== undefined;
  return (
    <div className={`quality-score quality-score-${tone}`}>
      <strong>{hasScore ? score : "—"}</strong>
      <span>{hasScore ? `系数 ${coefficient.toFixed(2)}` : "等待评分"}</span>
    </div>
  );
}
